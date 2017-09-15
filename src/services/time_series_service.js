/*
 * Copyright (C) 2017 TopCoder Inc., All Rights Reserved.
 */
/**
 * This module contains the time series service implementation. It is used to send time
 * series data points to the Predix time series service.
 *
 * The data to be sent is queued and sent in batches, and if a failure occurs when
 * sending the data, it will be resent again after a period of time. This step ensures
 * that even in the event of a temporary network failure, no data will be lost.
 */

'use strict';

const WebSocket = require('ws');
const Promise = require('bluebird');
const _ = require('lodash');
const Helper = require('../common/helper');
const HttpsProxyAgent = require('https-proxy-agent');
const url = require('url');
const constants = require('../../config/simulator_constants');

/**
 * The logger object used to log messages.
 * @private
 */
let logger;

/**
 * The queue used to store data yet to be sent to Predix.
 * @private
 */
let queue;

/**
 * The flag indicating whether a send (to Predix) operation is already in progress.
 * @private
 */
let isOperationInProgress;

/**
 * The web socket object used to send the data points to Predix time series service.
 * @private
 */
let ws;

/**
 * The array of items that are currently being sent to Predix.
 * @private
 */
let itemsInProgress;

/**
 * The total number of send requests for time series data sent to Predix.
 */
let totSent;

/**
 * The Predix security token used to access Predix.
 * @private
 */
let token;

/**
 * The Predix configuration which contains the Predix service names, GUIDs, etc.
 * @private
 */
let predixConfig;

/**
 * Tags used when sending asset service messages to Predix. Each tag contains an attributes
 * object which is the attributes that will be sent along with the time series data points.
 *
 * Important Note:
 * Predix does not seem to allow spaces in attribute values, and you don't get any error back,
 * it just doesn't load the time series data.
 * This problem seems to be a bug since their documentation doesn't mention any restrictions
 * on attribute values.
 * To work around this limitation, we use underscores in the "details" attributes.
 * @private
 */
const tags = [
  {
    name: 'distance',
    attributes: {
      units: 'meters',
      details: 'distance_travelled_by_the_locomotive',
    },
  },
  {
    name: 'fuelMassBurning',
    attributes: {
      units: 'kg',
      details: 'fuel_mass_currently_ignited_and_burning_inside_the_fire_chamber',
    },
  },
  {
    name: 'fuelMassInTender',
    attributes: {
      units: 'kg',
      details: 'fuel_mass_currently_in_tender',
    },
  },
  {
    name: 'fuelMassInFireChamber',
    attributes: {
      units: 'kg',
      details: 'fuel_mass_currently_inside_the_fire_chamber_burning_and_non-burning',
    },
  },
  {
    name: 'pressure',
    attributes: {
      units: 'bar',
      details: 'current_boiler_pressure_of_locomotive',
    },
  },
  {
    name: 'speed',
    attributes: {
      units: 'meters_per_second',
      details: 'current_speed_of_the_locomotive',
    },
  },
  {
    name: 'time',
    attributes: {
      units: 'seconds',
      details: 'time_that_has_passed_since_locomotive_began_traveling',
    },
  },
];

/**
 * Sets up the web socket to use a proxy (if necessary).
 *
 * @param {Object} options the web socket options object
 * @param {string} endpoint the web socket endpoint
 */
const setupProxy = (options, endpoint) => {
  // setup proxy if necessary
  const proxy = process.env.http_proxy || undefined;
  let agent;
  if (!_.isUndefined(proxy)) {
    logger.logDebug(`using proxy server ${proxy}`);

    // WebSocket endpoint for the proxy to connect to
    url.parse(endpoint);

    // create an instance of the `HttpsProxyAgent` class with the proxy server information
    const proxyOptions = url.parse(proxy);

    agent = new HttpsProxyAgent(proxyOptions);

    options.agent = agent;
  }
};

/**
 * Builds the body for sending data to the Predix time series service.
 *
 * @returns {Array} an array containing the time series data points to send to Predix
 * @private
 */
const buildBody = () => {
  // process all itemsInProgress nodes and build body to send to time series websocket

  const body = [];

  _.forEach(tags, (tag) => {
    // find the existing element in body for this tag
    const matches = _.filter(body, { name: tag.name });
    let bodyElement = matches.length === 0 ? undefined : matches[0];

    if (_.isUndefined(bodyElement)) {
      // didn't find the bodyElement, so let's create it
      bodyElement = { name: tag.name, datapoints: [], attributes: tag.attributes };
      body.push(bodyElement);
    }

    // loop over the itemsInProgress nodes and add the data points to the bodyElement for this tag
    _.forEach(itemsInProgress, (node) => {
      const timestamp = Math.round(node.data.time * 1000); // convert seconds to milliseconds and round
      const dataVal = node.data[tag.name];
      bodyElement.datapoints.push([timestamp, dataVal]);
    });
  });

  return body;
};

/**
 * Creates a web socket to use for sending the time series data points to Predix.
 *
 * @returns {Object} a Promise which will resolve once data has been queued to be sent to Predix
 * @private
 */
const createWebSocket = () => new Promise(async (resolve) => {
  logger.logDebug(`inside TimeSeriesService.createWebSocket, setting options using token = ${token}`);
  const options = {
    headers: {
      Authorization: 'Bearer ' + token,
      'Predix-Zone-Id': predixConfig.time_series_service_instance_guid,
      Origin: 'http://www.topcoder.com',
    },
  };
  const endpoint = predixConfig.time_series_websocket_url;

  // setup proxy if necessary
  setupProxy(options, endpoint);

  logger.logDebug(`options = ${JSON.stringify(options)}`);

  logger.logDebug('creating WebSocket');
  ws = new WebSocket(endpoint, null, options);
  logger.logDebug('WebSocket created');

  // wire up the websocket events

  /**
   * Called once web socket is opened.
   */
  ws.on('open', () => {
    const msg = 'socket opened!';
    logger.logDebug(msg);
    resolve(msg);
  });

  /**
   * Called once web socket message has been sent successfully to Predix.
   *
   * @param {Object} msg the message object returned from the web socket
   */
  ws.onmessage = function (msg) {
    totSent += itemsInProgress.length;

    logger.logDebug(
      `time series data sent successfully, totSent is now ${totSent}, ` +
      `message response from sending time series data over socket: ${msg.data} `);

    // remove the items from the queue that were sent successfully
    Helper.removeProcessedItemsFromQueue(queue, itemsInProgress, 'TimeSeriesService');

    isOperationInProgress = false;
    logger.logDebug('TimeSeriesService.isOperationInProgress is now false');

    // if there are still nodes in the queue, we need to process them
    if (queue.length !== 0) {
      logger.logDebug(`there are still nodes in the TimeSeriesService.queue, queue.length = ${queue.length}`);
      processTimeSeriesData();    // eslint-disable-line
    } else {
      // queue is empty, so let's close the socket
      logger.logDebug('TimeSeriesService.queue is empty, so closing socket');
      ws.close();
      ws = undefined;
    }
  };

  /**
   * Called once web socket is closed.
   */
  ws.onclose = function () {
    logger.logDebug('socket closed');
  };

  /**
   * Called if there is a socket error.
   *
   * @param {Object} evt the error event object
   */
  ws.onerror = function (evt) {
    logger.logError(`socket error!!! ${evt}`, evt);
    ws = undefined;
    // try to send again after some period of time
    setTimeout(async () => {
      logger.logInfo('socket connection failed, so calling TimeSeriesService.processTimeSeriesData to try again');
      isOperationInProgress = false;

      // generate a new predix token
      token = await Helper.getPredixToken(predixConfig.uaa_url, predixConfig.client_id, predixConfig.client_secret);

      // try to send the data again
      processTimeSeriesData();    // eslint-disable-line
    }, constants.WAIT_SECONDS_BETWEEN_FAILED_REQUESTS * 1000);
  };
});

/**
 * Processes all the time series data in the itemsInProgress array and sends it to Predix.
 * If a send operation is already in progress, it will not send the data (the data
 * will get sent once the other operation finishes).
 *
 * @returns {Object} a Promise which will resolve once data has been queued to be sent to Predix
 * @private
 */
const processTimeSeriesData = () => new Promise(async (resolve, reject) => {
  try {
    logger.logDebug('entered processTimeSeriesData');

    if (isOperationInProgress) {
      // an existing WebSocket operation is in progress, so nothing to do
      logger.logDebug('WebSocket operation already in progress');
      resolve('operation already in progress');
      return;
    }
    isOperationInProgress = true;

    // get the nodes we are getting ready to send to predix
    itemsInProgress = [];
    Helper.setItemsInProgress(queue, itemsInProgress);

    // make sure we still have work to do
    if (itemsInProgress.length === 0) {
      logger.logDebug('in TimeSeriesService.processAssetData, itemsInProgress is empty, so nothing to do.');
      isOperationInProgress = false;
      logger.logDebug('TimeSeriesService.isOperationInProgress is now false');
      resolve('no more items to process');
      return;
    }

    // build the body we will send to the predix websocket
    const body = buildBody();

    const payload = {
      messageId: (new Date()).getTime(),
      body,
    };
    logger.logDebug(`time series payload =  ${JSON.stringify(payload)}`);

    // resolve immediately so caller can continue; don't wait for data to be sent
    resolve('data queued');

    // create a new websocket if needed
    if (_.isUndefined(ws)) {
      logger.logDebug('creating a new websocket');
      await createWebSocket();
      logger.logDebug('done creating a new websocket');
    }

    // send the data to predix!
    const readyState = _.isUndefined(ws) ? 'undefined' : ws.readyState;
    logger.logDebug(`preparing to send data to predix, ws.readyState = ${readyState}`);
    ws.send(JSON.stringify(payload));
  } catch (e) {
    const msg = `Error in TimeSeriesService.processTimeSeriesData: ${e}`;
    logger.logError(msg, e);
    reject(msg);
  }
});

/**
 * This class is used to allow the user to send time series data to Predix time series service.
 */
module.exports = class TimeSeriesService {

  /**
   * Constructs a new instance of this class.
   *
   * @param {Object} tok the Predix security token
   * @param {Object} log the logger
   */
  constructor(tok, log) {
    queue = [];
    isOperationInProgress = false;
    ws = undefined;
    totSent = 0;
    token = tok;
    logger = log;
    predixConfig = require('../../config/predix_config');    // eslint-disable-line
  }

  /**
   * Sends the data to Predix time series service.
   *
   * @param {Object} data the data to send
   * @returns {Object} a Promise which will resolve once data has been queued to be sent to Predix
   */
  sendDataToPredix(data) {
    logger.logDebug('inside TimeSeriesService.sendDataToPredix');

    // add node to queue
    queue.push({ key: Helper.getId(), data });

    // process the time series data and send it to predix
    return processTimeSeriesData();
  }

  /**
   * Gets total number of send requests for time series data sent to Predix.
   *
   * @returns {number} total number of send requests
   */
  getTotalRequestsSent() {
    return totSent;
  }

  /**
   * Determines whether the service has finished sending all queued data to Predix.
   *
   * @returns {boolean} flag indicating whether service has finished
   */
  isFinished() {
    return queue.length === 0 && !isOperationInProgress;
  }

};

