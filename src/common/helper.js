/*
 * Copyright (C) 2017 TopCoder Inc., All Rights Reserved.
 */
/**
 * This module contains common code used by the application.
 */

'use strict';

const constants = require('../../config/simulator_constants');
const uaa_util = require('predix-uaa-client');  // eslint-disable-line
const _ = require('lodash');

/**
 * Contains the set of ids already generated so far.
 * @private
 */
const usedIds = new Set();

/**
 * The logger object used to log messages.
 * @private
 */
let logger;

/**
 * Generates a GUID.
 * Public Domain/MIT, code taken from here: https://goo.gl/6nt8dW
 *
 * @returns a GUID
 * @private
 */
const generateId = () => {
  let d = new Date().getTime();
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') { // eslint-disable-line
    // use high-precision timer if available
    d += performance.now(); // eslint-disable-line
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (d + Math.random() * 16) % 16 | 0; // eslint-disable-line
    d = Math.floor(d / 16);
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); // eslint-disable-line
  });
};

/**
 * This class contains common code used by the application.
 */
module.exports = class Helper {

  /**
   * Injects a logger object to use in this class.
   *
   * @param {Object} log logger to inject
   */
  static setLogger(log) {
    logger = log;
  }

  /**
   * Escapes a string so that all regular expression characters are delimited.
   *
   * @param {string} str the string to delimited
   * @returns {string} delimited string
   */
  static escapeRegExp(str) {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');  // eslint-disable-line
  }

  /**
   * Replaces all occurrences of parameter find with parameter replace in parameter str.
   *
   * @param {string} str the original string
   * @param {string} find the string to find
   * @param {string} replace the replacement string
   * @returns the updated string after replacements
   */
  static replaceAll(str, find, replace) {
    return str.replace(new RegExp(Helper.escapeRegExp(find), 'g'), replace);
  }

  /**
   * Gets a new Predix security token to use when accessing Predix services.
   *
   * @param {string} uaaUrl the URL of the Predix UAA service
   * @param {*} id the id to use for the UAA service
   * @param {*} secret the secret to use for the UAA service
   * @returns the Predix security token
   */
  static async getPredixToken(uaaUrl, id, secret) {
    try {
      logger.logDebug('entered Helper.getPredixToken to generate a new token...');
      const token = await uaa_util.getToken(uaaUrl + '/oauth/token', id, secret);
      logger.logDebug('Helper.getPredixToken result: ' + token.access_token);
      return token.access_token;
    } catch (e) {
      logger.logError(`Error getting token in Helper.getPredixToken: ${e}`, e);
      return 'no_token';
    }
  }

  /**
   * Generates a new id.  The id will be a GUID.
   *
   * @returns {string} GUID
   */
  static getId() {
    try {
      const id = generateId();

      // check for duplicate id (probably won't ever happen, but just in case)
      if (usedIds.has(id)) {
        logger.logDebug('Got a duplicate Id in Helper.getId()!');
        return Helper.getId();
      }
      usedIds.add(id);
      logger.logDebug(`id generated from Helper.getId is ${id}`);
      return id;
    } catch (e) {
      logger.logError(`could not get id: ${e}`, e);
      return 'no_id';
    }
  }

  /**
   * Loads nodes from queue to itemsInProgress array so they can be sent to a Predix service.
   *
   * @param {Object} queue the queue containing all the nodes not sent to Predix yet
   * @param {Object} itemsInProgress the array which will get the queue's nodes loaded to it
   */
  static setItemsInProgress(queue, itemsInProgress) {
    logger.logDebug('inside Helper.setItemsInProgress');
    // load the nodes we are getting ready to send to predix to itemsInProgress
    _.forEach(queue, (node) => {    // eslint-disable-line
      itemsInProgress.push(node);

      // limit the number of nodes to send during one operation
      if (itemsInProgress.length === constants.MAX_NODES_TO_QUEUE_PER_SEND) {
        return false;
      }
    });
    logger.logDebug(`leaving Helper.setItemsInProgress, itemsInProgress.length = ${itemsInProgress.length}`);
  }

  /**
   * Removes the processed items (e.g. items sent to Predix successfully) from the queue.
   *
   * @param {Object} queue the queue
   * @param {Object} itemsInProgress the array containing the nodes successfully sent to Predix
   * @param {string} serviceType the type of Predix service (e.g. time series, etc.)
   */
  static removeProcessedItemsFromQueue(queue, itemsInProgress, serviceType) {
    logger.logDebug(
      `removing processed items from ${serviceType}.queue, itemsInProgress.length = ${itemsInProgress.length}`);
    _.forEach(itemsInProgress, (item) => {
      logger.logDebug(`removing item in ${serviceType}.queue for key: ${item.key}`);
      _.remove(queue, { key: item.key });
    });
  }

};
