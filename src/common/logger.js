/*
 * Copyright (C) 2017 TopCoder Inc., All Rights Reserved.
 */
/**
 * This module returns a winston logger which can be used for logging.
 */

'use strict';

const fs = require('fs');
const _ = require('lodash');
const winston = require('winston');
const util = require('util');
const constants = require('../../config/simulator_constants');
const Helper = require('./helper');

/**
 * Logs message at given level.
 * @param {Object} logger the logger object
 * @param {string} level the logging level
 * @param {string} msg  the message to log
 * @param {Array} args the placeholder values that correspond to the placeholders (e.g. %s, %j, etc.) in msg.
 */
const logMsg = (logger, level, msg, ...args) => {
  logger.log(level, util.format(msg, ...args));
};

module.exports = (logFileName, isConsoleLoggingEnabled) => {
  // create the logging transports to use with the logger
  const transports = [];
  if (!constants.DISABLE_LOGGING) {
    if (isConsoleLoggingEnabled) {
      // create a console transport
      transports.push(new (winston.transports.Console)({ prettyPrint: true, level: constants.LOG_LEVEL }));
    }

    // create a file transport
    if (!_.isUndefined(logFileName)) {
      // delete existing log file if it exists
      const file = constants.LOGS_DIR + '/' + logFileName;
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
      // create logs directory if it doesn't exist
      if (!fs.existsSync(constants.LOGS_DIR)) {
        fs.mkdirSync(constants.LOGS_DIR);
      }

      transports.push(new (winston.transports.File)(
        {
          json: false,
          prettyPrint: true,
          filename: constants.LOGS_DIR + '/' + logFileName,
          level: constants.LOG_LEVEL,
        }));
    }
  }
  const logger = new (winston.Logger)({ transports });

  /**
   * Logs message at debug level.
   * @param {string} msg the message to log
   * @param {Array} args the placeholder values that correspond to the placeholders (e.g. %s, %j, etc.) in msg.
   */
  logger.logDebug = (msg, ...args) => {
    logMsg(logger, 'debug', msg, ...args);
  };

  /**
   * Logs message at error level.
   * @param {string} msg the message to log
   * @param {Array} args the placeholder values that correspond to the placeholders (e.g. %s, %j, etc.) in msg.
   */
  logger.logError = (msg, ...args) => {
    logMsg(logger, 'error', msg, ...args);
  };

  /**
   * Logs message at info level.
   * @param {string} msg the message to log
   * @param {Array} args the placeholder values that correspond to the placeholders (e.g. %s, %j, etc.) in msg.
   */
  logger.logInfo = (msg, ...args) => {
    logMsg(logger, 'info', msg, ...args);
  };

  // inject the logger into Helper
  Helper.setLogger(logger);

  return logger;
};
