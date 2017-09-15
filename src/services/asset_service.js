/*
 * Copyright (C) 2017 TopCoder Inc., All Rights Reserved.
 */
/**
 * This module contains the asset service implementation. It is used to send asset
 * messages to the Predix asset service.
 *
 * The data to be sent is queued and sent in batches, and if a failure occurs when
 * sending the data, it will be resent again after a period of time. This step ensures
 * that even in the event of a temporary network failure, no data will be lost.
 */

'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const Helper = require('../common/helper');
const request = require('superagent');
const constants = require('../../config/simulator_constants');

// wire up proxy if needed
if (process.env.http_proxy) {
  require('superagent-proxy')(request);    // eslint-disable-line
}

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
 * The array of items that are currently being sent to Predix.
 * @private
 */
let itemsInProgress;

/**
 * An object containing the total number of sends for each asset key (speed, pressure, etc.)
 * @private
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
 * Builds the request body for sending data to the Predix asset service.
 *
 * @returns {Array} an array containing the asset messages to send to Predix
 * @private
 */
const buildBody = () => {
  // process all itemsInProgress nodes and build json body to send to asset service

  const body = [];

  // loop over the itemsInProgress nodes and add the asset json object
  _.forEach(itemsInProgress, (node) => {
    const timestamp = Math.round(node.data.time * 1000); // convert seconds to milliseconds and round
    const obj = {
      uri: '/locomotive/' + node.data.key + '.' + timestamp,
      locomotiveId: constants.LOCOMOTIVE_ID,
      timestamp,
      name: node.data.key,
      val: node.data.val,
      msg: node.data.msg,
    };

    body.push(obj);
  });

  logger.logDebug(`in AssetService.buildBody, body = ${JSON.stringify(body)}`);

  return body;
};

/**
 * Handles response from post request to send data to Predix asset service.
 *
 * @param {Object} err the error object
 * @param {Object} res the response object
 * @param {Object} body the body used in the post request
 */
const handlePostResponse = (err, res, body) => {
  if (err || !res.ok) {
    // request failed!!
    isOperationInProgress = false;
    logger.logError(`asset request FAILED when posting body ${JSON.stringify(body)}.`);
    logger.logError(`Error details for asset request failure: ${err}`, err);

    // wait for some time, then try to send the data again
    setTimeout(async () => {
      logger.logDebug('asset request failed, so calling AssetService.processAssetData to try again');
      isOperationInProgress = false;
      logger.logDebug('AssetService.isOperationInProgress is now false');

      // generate a new predix token
      token = await Helper.getPredixToken(predixConfig.uaa_url, predixConfig.client_id,
        predixConfig.client_secret);

      // try to send the data again
      processAssetData();   // eslint-disable-line
    }, constants.WAIT_SECONDS_BETWEEN_FAILED_REQUESTS * 1000);
  } else {
    // request was successful!

    // update total sent values for each asset
    _.forEach(itemsInProgress, (node) => {
      if (_.isUndefined(totSent[node.data.key])) {
        logger.logDebug(`node.data.key = ${node.data.key}`);
        totSent[node.data.key] = 0;
      }
      ++totSent[node.data.key];
    });

    // log some debug info about the sent data
    logger.logDebug(
      `asset request sent successfully, res.statusCode = ${res.statusCode}`);
    _.forOwn(totSent, (value, key) => {
      logger.logDebug(`totSent.${key} is now = ${value}`);
    });

    // remove the items from the queue that were sent successfully
    Helper.removeProcessedItemsFromQueue(queue, itemsInProgress, 'AssetService');

    isOperationInProgress = false;
    logger.logDebug('AssetService.isOperationInProgress is now false');

    // if there are still nodes in the queue, we need to process them
    if (queue.length !== 0) {
      logger.logDebug(`there are still nodes in the AssetService.queue, queue.length = ${queue.length}`);
      processAssetData(); // eslint-disable-line
    }
  }
};

/**
 * Processes all the asset data in the itemsInProgress array and sends it to Predix.
 * If a send operation is already in progress, it will not send the data (the data
 * will get sent once the other operation finishes).
 *
 * @returns {Object} a Promise which will resolve once data has been queued to be sent to Predix
 * @private
 */
const processAssetData = () => new Promise(async (resolve, reject) => {
  try {
    logger.logDebug('entered AssetService.processAssetData');

    if (isOperationInProgress) {
      // an existing post operation is in progress, so nothing to do
      logger.logDebug('in AssetService.processAssetData, post operation already in progress');
      resolve('operation already in progress');
      return;
    }
    isOperationInProgress = true;

    // get the nodes we are getting ready to send to predix
    itemsInProgress = [];
    Helper.setItemsInProgress(queue, itemsInProgress);

    // make sure we still have work to do
    if (itemsInProgress.length === 0) {
      logger.logDebug('in AssetService.processAssetData, itemsInProgress is empty, so nothing to do.');
      isOperationInProgress = false;
      logger.logDebug('AssetService.isOperationInProgress is now false');
      resolve('no more items to process');
      return;
    }

    // resolve immediately so caller can continue; don't wait for data to be sent
    resolve('data queued');

    const body = buildBody();
    const url = predixConfig.asset_service_url + 'locomotive';

    // build post request to post the asset data
    const postReq = request.post(url);
    if (!_.isUndefined(postReq.proxy)) {
      logger.logDebug(`using proxy: ${process.env.http_proxy}`);
      postReq.proxy(process.env.http_proxy);
    }
    logger.logDebug('sending asset data via post request...');
    postReq
      .set('Authorization', 'Bearer ' + token)
      .set('predix-zone-id', predixConfig.asset_service_instance_guid)
      .send(body)
      .end((err, res) => handlePostResponse(err, res, body));
  } catch (e) {
    const msg = `Error in AssetService.processAssetData: ${e}`;
    logger.logError(msg, e);
    reject(msg);
  }
});

/**
 * This class is used to allow the user to send asset messages to Predix asset service.
 */
module.exports = class AssetService {

  /**
   * Constructs a new instance of this class.
   *
   * @param {Object} tok the Predix security token
   * @param {Object} log the logger
   */
  constructor(tok, log) {
    queue = [];
    isOperationInProgress = false;
    totSent = {};
    token = tok;
    logger = log;
    predixConfig = require('../../config/predix_config');    // eslint-disable-line
  }

  /**
   * Sends the data to Predix asset service.
   *
   * @param {Object} data the data to send
   * @returns {Object} a Promise which will resolve once data has been queued to be sent to Predix
   */
  sendDataToPredix(data) {
    logger.logDebug(`inside AssetService.sendDataToPredix, data = ${JSON.stringify(data)}`);

    // add node to queue
    queue.push({ key: Helper.getId(), data });

    // process the asset data and send it to predix
    return processAssetData();
  }

  /**
   * Gets an object describing the total requests sent for the asset data.
   *
   * @returns {Object} an object containing the total number of sends for each asset key (speed, pressure, etc.)
   */
  getTotalRequestsSent() {
    return JSON.stringify(totSent);
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

