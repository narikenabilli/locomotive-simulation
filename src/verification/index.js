/*
 * Copyright (C) 2017 TopCoder Inc., All Rights Reserved.
 */
/**
 * This module contains the Predix verification utility. It will query the time
 * series and asset services in Predix to allow the user to view the data sent
 * to Predix from the simulator.
 *
 * It can be run using 'npm run verify'.
 */

'use strict';

const fs = require('fs');
const readlineSync = require('readline-sync');
const _ = require('lodash');
const Helper = require('../common/helper');
const jsonfile = require('jsonfile');
const request = require('superagent');
const constants = require('../../config/simulator_constants');
const logger = require('../common/logger')(constants.VERIFICATION_LOGFILE_NAME, false);

/**
 * The Predix configuration which contains the Predix service names, GUIDs, etc.
 */
let predixConfig;

/**
 * The Predix security token used to access Predix.
 */
let token;

// setup proxy if required
if (process.env.http_proxy) {
  require('superagent-proxy')(request); // eslint-disable-line
}

/**
 * Logs a message and arguments.
 *
 * @param {string} msg the message to log
 * @param {...Object} args the arguments to log
 */
const logMsg = (msg, ...args) => {
  console.log(msg, ...args);    // eslint-disable-line
  if (msg !== '') {
    logger.logInfo(msg, ...args);
  }
};

/**
 * Gets messages sent to Predix asset data service for given asset name and
 * writes the messages to an output file as a json object.
 *
 * @param {string} assetName the name of the asset for which to fetch the data
 * @returns {boolean} flag indicating whether method succeeded
 */
const getAssetData = async (assetName) => {
  try {
    const assetUrl = predixConfig.asset_service_url + 'locomotive?filter=name=' + assetName;

    logMsg(`assetUrl = ${assetUrl}`);

    // build GET request to fetch asset data
    const assetReq = request.get(assetUrl);
    if (!_.isUndefined(assetReq.proxy)) {
      logMsg(`using proxy: ${process.env.http_proxy}`);
      assetReq.proxy(process.env.http_proxy);
    }

    // fetch the asset data from Predix
    logMsg('getting asset data via GET request...');
    const res = await assetReq
      .set('Authorization', 'Bearer ' + token)
      .set('predix-zone-id', predixConfig.asset_service_instance_guid);
    logMsg(`res.body ${JSON.stringify(res.body)}`);

    // write the data to the output file
    const outputFile = constants.LOGS_DIR + '/asset_' + assetName + '.log';
    logMsg(`writing ${assetName} asset data to ${outputFile}`);
    jsonfile.writeFileSync(outputFile, res.body, { spaces: 2 });
    logMsg('\n');
    logMsg(`'${assetName}' asset data written successfully to ${outputFile}.\n${res.body.length} records ` +
     'were written.');
    if (res.body.length === 0) {
      logMsg('Make sure you have run the simulator to generate data.');
    }

    readlineSync.question('\nPress enter to continue...');

    return true; // success
  } catch (err) {
    // request failed!!
    logMsg(`Could not get ${assetName} asset data: `, err);
    return false; // failure
  }
};

/**
 * Gets messages sent to Predix time series service and
 * writes the messages to an output file as a json object.
 *
 * @returns {boolean} flag indicating whether method succeeded
 */
const getTimeSeriesData = async () => {
  try {
    const outputFile = constants.LOGS_DIR + '/time_series_data.log';

    const tagsUrl = predixConfig.time_series_url + 'tags';

    // build GET request to fetch the time series tags
    const tagsReq = request.get(tagsUrl);
    if (!_.isUndefined(tagsReq.proxy)) {
      logMsg(`using proxy: ${process.env.http_proxy}`);
      tagsReq.proxy(process.env.http_proxy);
    }

    // fetch the time series tags from Predix
    logMsg('getting time series tags via GET request...');
    let res = await tagsReq
      .set('Authorization', 'Bearer ' + token)
      .set('predix-zone-id', predixConfig.time_series_service_instance_guid);
    logMsg(`res.body ${JSON.stringify(res.body)}`);
    if (res.body.results.length === 0) {
      logMsg(`writing time series data to ${outputFile}`);
      jsonfile.writeFileSync(outputFile, res.body, { spaces: 2 });
      logMsg('\n');
      logMsg(`time series data written successfully to ${outputFile}.\n0 records were written.`);
      logMsg('Make sure you have run the simulator to generate data.');
      readlineSync.question('\nPress enter to continue...');
      return true;
    }

    // build the data point query used to fetch the time series data
    const datapointsQuery = {
      start: '5000y-ago', // we want all the data, so just use a silly value here
      tags: [],
    };

    // add the tags to the query
    _.forEach(res.body.results, (tag) => {
      datapointsQuery.tags.push({
        name: tag,
        order: 'desc',
      });
    });

    logMsg(`datapointsQuery = ${JSON.stringify(datapointsQuery, null, 2)}`);
    const datapointsUrl = predixConfig.time_series_url + 'datapoints';

    // build POST request to get the data points from time series service
    const datapointsReq = request.post(datapointsUrl);
    if (!_.isUndefined(datapointsReq.proxy)) {
      logMsg(`using proxy: ${process.env.http_proxy}`);
      datapointsReq.proxy(process.env.http_proxy);
    }

    // fetch the time series data from Predix
    res = await datapointsReq
      .set('Authorization', 'Bearer ' + token)
      .set('predix-zone-id', predixConfig.time_series_service_instance_guid)
      .send(datapointsQuery);

    // write the data to the output file
    logMsg(`writing time series data to ${outputFile}`);
    jsonfile.writeFileSync(outputFile, res.body, { spaces: 2 });
    logMsg('\n');
    logMsg(`Time series data written successfully to ${outputFile}.\nStats listed below:\n`);
    logMsg('  -------------------------------------------------------------');
    logMsg('  Tag                                   Num Data Points Written');
    logMsg('  -------------------------------------------------------------');
    _.forEach(res.body.tags, (o) => {
      logMsg(`  ${_.padEnd(o.name, 38)}${o.stats.rawCount}`);
    });

    readlineSync.question('\nPress enter to continue...');
    return true; // success
  } catch (err) {
    // request failed!!
    logMsg('Could not get time series data: ', err);
    return false; // failure
  }
};

/**
 * Runs the verification utility to allow the user to view the time
 * series and asset data sent to Predix.
 */
const runVerification = async () => {
  try {
    logMsg('');
    logMsg('');
    logMsg('-------------------------------------------------------');
    logMsg('               Predix Verification Utility             ');
    logMsg('-------------------------------------------------------');

    // get token to use with predix services
    logMsg('getting token to use with predix services...');
    token = await Helper.getPredixToken(predixConfig.uaa_url, predixConfig.client_id, predixConfig.client_secret);
    if (token === 'no_token') {
      logMsg('Unable to get Predix token.\nMake sure your internet connection is working, and view the ' +
        `${constants.LOGS_DIR}/${constants.VERIFICATION_LOGFILE_NAME} for more details on the error.`);
      return;
    }

    let choice;
    for (; ;) {
      logMsg(' Please choose an option:                 ');
      logMsg(' 1) Get time series data sent by simulator to predix');
      logMsg(' 2) Get asset service messages sent by simulator for speed');
      logMsg(' 3) Get asset service messages sent by simulator for pressure');
      logMsg(' 4) Get asset service messages sent by simulator for fuelMassInTender');
      logMsg(' 5) Quit');
      logMsg('\n');

      let result = true;
      choice = 'none';
      choice = readlineSync.question('Please enter the number of the option you wish to perform: ');
      choice = choice.trim();
      switch (choice) {
        case '1':
          result = await getTimeSeriesData(); // eslint-disable-line
          break;
        case '2':
          result = await getAssetData('speed'); // eslint-disable-line
          break;
        case '3':
          result = await getAssetData('pressure'); // eslint-disable-line
          break;
        case '4':
          result = await getAssetData('fuelMassInTender'); // eslint-disable-line
          break;
        case '5':
          logMsg('Goodbye');
          return;
        default:
          logMsg('\n\n\n***** Invalid choice, try again (enter the number of the option, like 1, etc.)\n\n');
          break;
      }

      if (!result) {
        logMsg('Exiting due to failure (see above or view the log file)');
        return;
      }
    }
  } catch (err) {
    logMsg('Error when running verification utility! ', err);
  }
};

// make sure setup was run before starting the verification (e.g. config file will exist if setup was run successfully)
if (!fs.existsSync('./config/predix_config.json')) {
  logMsg('--------------------------');
  logMsg('The ./config/predix_config.json file was not found. You must run "npm run setup" before running ' +
    'the verification utility');
  logMsg('--------------------------');
  Helper.exitProcess(1);
}

// load the config file
predixConfig = require('../../config/predix_config.json');

runVerification();

