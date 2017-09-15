/*
 * Copyright (C) 2017 TopCoder Inc., All Rights Reserved.
 */
/**
 * This module contains the Predix setup utility. It will create the Predix UAA, asset
 * and time series services and will create a client bound against these services.
 * The utility can be invoked by using 'npm run setup'.
 *
 * Before running this utility, you can edit the config/predix_config_template.json file
 * to update any values you need (ex. if you want to use different service names
 * than the defaults, etc.)
 *
 * If you wish to delete the services and client created by this utility, you can run
 * 'npm run cleanup'.
 */

'use strict';

const commandExistsSync = require('command-exists').sync;
const fs = require('fs');
const Promise = require('bluebird');
const readlineSync = require('readline-sync');
const { exec } = require('child_process');
const predixConfig = require('../../config/templates/predix_config_template.json');
const _ = require('lodash');
const Helper = require('../common/helper');
const jsonfile = require('jsonfile');
const request = require('superagent');
const constants = require('../../config/simulator_constants');
const logger = require('../common/logger')(constants.SETUP_LOGFILE_NAME, false);

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
  console.log(msg, ...args);   // eslint-disable-line
  if (msg !== '') {
    logger.logInfo(msg, ...args);
  }
};

/**
 * Gets a configuration value for given key.
 *
 * @param {string} key the configuration key
 * @returns {string} the configuration value
 * @throws {Error} if configuration value is missing
 */
const getConfigVal = (key) => {
  if (_.isUndefined(predixConfig[key])) {
    const errMsg = `Missing config value for '${key}'. Please check config/templates/predix_config_template.json`;
    throw new Error(errMsg);
  }
  return predixConfig[key];
};

/**
 * Writes the Predix configuration to a file.
 */
const writeConfigToFile = () => {
  const outputFile = './config/predix_config.json';
  logMsg('\n------------------------------------------');
  logMsg(`writing config file to ${outputFile}`);
  jsonfile.writeFileSync(outputFile, predixConfig, { spaces: 2 });
};

/**
 * Executes a given command in the shell.
 *
 * @param {string} cmd the command to execute
 * @param {string} password the password to supply to the command if required
 * @returns {Object} a Promise for the command execution
 */
const executeCommand = (cmd, password) => {
  let filteredCmd = cmd;

  // don't show the password in console or logs
  if (!_.isUndefined(password)) {
    filteredCmd += ' password_not_shown';
    cmd += ' ' + password;
  }
  logMsg(`executing command: ${filteredCmd}`);
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        logMsg(`Could not execute command ${cmd}: ${stdout} ${stderr}`);
        if (!_.isUndefined(password)) {
          logMsg('Please make sure your login credentials are valid. You can try the "cf login" command directly ' +
            'from the command line to verify your login credentails. Then try running setup again once you have ' +
            'verified you can login successfully using "cf login".\n\n');
        }
        process.exit(1);
      }
      logMsg(`command output: ${stdout}`);
      resolve(stdout);
    });
  });
};

/**
 * Gets the GUID for the given Predix service instance.
 *
 * @param {string} serviceInstance name of Predix service instance
 * @returns {string} the GUID of the service instance
 */
const getServiceGuid = async (serviceInstance) => {
  logMsg(`getting service guid for ${serviceInstance}...`);
  let guid = await executeCommand(`cf service ${serviceInstance} --guid`);

  // remove newline from end
  guid = guid.replace(/^\s+|\s+$/g, '');

  return guid;
};

/**
 * Creates a Predix service.
 *
 * @param {string} service the type of Predix service (ex: predix-timeseries)
 * @param {string} plan the Predix plan type (ex: Free)
 * @param {string} serviceInstance name to use for service
 * @param {Object} jsonData data to pass to cf command when creating service
 * @returns {string} GUID of newly created service
 */
const createPredixService = async (service, plan, serviceInstance, jsonData) => {
  logMsg('\n------------------------------------------');
  logMsg(`creating ${service} service...`);
  await executeCommand(`cf create-service ${service} ${plan} ${serviceInstance} -c ${jsonData}`);

  // return the guid of the newly created service
  const guid = await getServiceGuid(serviceInstance);
  return guid;
};

/**
 * Creates a Predix client which will be used to access Predix services.
 *
 * @throws {Object} if client can't be created
 */
const createPredixClient = async () => {
  logMsg('\n------------------------------------------');
  logMsg('creating predix client...');

  // get an admin token which we'll need to create the client
  const token = await Helper.getPredixToken(predixConfig.uaa_url, 'admin', predixConfig.uaa_admin_client_secret);

  // get client template to use for creating client
  let clientTemplate = fs.readFileSync('./config/templates/client_template.json', 'utf8');

  // plug in values to template
  clientTemplate = Helper.replaceAll(clientTemplate, '<client_id>', predixConfig.client_id);
  clientTemplate = Helper.replaceAll(clientTemplate, '<client_secret>', predixConfig.client_secret);
  clientTemplate = Helper.replaceAll(clientTemplate, '<time_series_service_instance>',
    predixConfig.time_series_service_instance);
  clientTemplate = Helper.replaceAll(clientTemplate, '<time_series_service_instance_guid>',
    predixConfig.time_series_service_instance_guid);
  clientTemplate = Helper.replaceAll(clientTemplate, '<asset_service_instance>',
    predixConfig.asset_service_instance);
  clientTemplate = Helper.replaceAll(clientTemplate, '<asset_service_instance_guid>',
    predixConfig.asset_service_instance_guid);
  clientTemplate = Helper.replaceAll(clientTemplate, '<predix_uaa_url>',
    predixConfig.uaa_url);

  logMsg(`clientTemplate is: ${clientTemplate}`);

  const url = predixConfig.uaa_url + '/oauth/clients';

  const postReq = request.post(url);
  if (!_.isUndefined(postReq.proxy)) {
    logMsg(`using proxy: ${process.env.http_proxy}`);
    postReq.proxy(process.env.http_proxy);
  }

  const body = JSON.parse(clientTemplate);
  logMsg('calling client api to create the client...');
  try {
    const res = await postReq
      .set('Authorization', 'Bearer ' + token)
      .set('Pragma', 'no-cache')
      .set('Content-Type', 'application/json')
      .send(body);
    logMsg(`back from call to create the client, res = ${JSON.stringify(res)}`);
    logMsg(`res.statusCode = ${res.statusCode}`);
    if (res.statusCode === 201) {
      logMsg('client created successfully!');
    }
  } catch (e) {
    const errMsg = 'Could not create client';
    logMsg(errMsg, e);
    throw e;
  }
};

/**
 * Logs into Predix. The user will be prompted for their Predix credentials.
 */
const loginToPredix = async () => {
  // login to predix
  logMsg('');
  logMsg('------------------------------------------');
  const loginId = readlineSync.question('What is your predix.io login id? ');
  const password = readlineSync.question('What is your predix.io password? ', {
    hideEchoBack: true, // The typed text on screen is hidden by `*` (default).
  });
  logMsg('logging in...');
  await executeCommand(`cf api ${getConfigVal('api')}`);
  await executeCommand(`cf auth ${loginId}`, password);

  // use the login id for org unless they specified it in the config template
  let org = getConfigVal('org');
  if (org === '<use_login_id>') {
    org = loginId;
  }
  await executeCommand(`cf target -o ${org} -s ${getConfigVal('space')}`);
  logMsg('login succeeded!');
};

/**
 * Deletes the Predix services and client created by this utility.
 */
const cleanup = async () => {
  logMsg('\n\ndeleting predix services...');
  await executeCommand(`cf ds ${getConfigVal('time_series_service_instance')} -f`);
  await executeCommand(`cf ds ${getConfigVal('asset_service_instance')} -f`);
  await executeCommand(`cf ds ${getConfigVal('uaa_service_instance')} -f`);
  logMsg('cleanup completed successfully');
};

/**
 * Builds the issuer id JSON data to pass when creating certain Predix services, such as Time
 * Series, etc.
 *
 * @param {string} uaaServiceInstance name of uaa service instance
 * @param {string} uaaGuid the guid of uaa service instance
 * @returns {Object} the issuer id JSON data
 */
const buildIssuerIdsJson = (uaaServiceInstance, uaaGuid) => {
  logMsg(`building issuer ids json using uaaGuid = ${uaaGuid}...`);
  let jsonData = '';
  if (process.platform === 'win32') {
    jsonData += ' "{\\"trustedIssuerIds\\":[<ids>]}" ';
  } else {
    jsonData += " '{\"trustedIssuerIds\":[<ids>]}' ";
  }

  let predixUaaUrl = getConfigVal('uaa_url_template');
  predixUaaUrl = predixUaaUrl.replace('<guid>', uaaGuid);
  predixUaaUrl += '/oauth/token';

  if (process.platform === 'win32') {
    predixUaaUrl = '\\"' + predixUaaUrl + '\\"';
  } else {
    predixUaaUrl = '"' + predixUaaUrl + '"';
  }

  jsonData = jsonData.replace('<ids>', predixUaaUrl);

  logMsg(`issuer ids json = ${jsonData}`);

  return jsonData;
};

/**
 * Runs the setup utility to create the Predix services and client.
 *
 * If the '--cleanup' command line argument is provided, then the services
 * and client will be deleted.
 */
const runSetup = async () => {
  try {
    let doCleanup = false;

    // parse command line args
    logMsg('command line arguments:');
    _.forEach(process.argv, (arg) => {
      logMsg(arg);
      if (arg === '--cleanup') {
        doCleanup = true;
      }
    });

    // make sure cloud foundry CLI is installed
    if (commandExistsSync('cf')) {
      // proceed
      logMsg('cf command exists, setup will proceed...');
    } else {
      logMsg('ERROR: cf command not found, make sure you have installed the Cloud Foundry CLI. Setup will exit');
      return;
    }

    logMsg('Checking cf version...');
    await executeCommand('cf --version');

    logMsg('');
    logMsg('');
    logMsg('------------------------------------------');
    logMsg('          Predix Setup Utility            ');
    logMsg('------------------------------------------');

    // login
    await loginToPredix();

    // check if we are cleaning up
    if (doCleanup) {
      // perform cleanup, which entails removing services, etc.
      await cleanup();
    } else {
      // perform regular setup -- setup predix services and client

      const plan = getConfigVal('plan');

      // create UAA service instance
      let jsonData = '';
      if (process.platform === 'win32') {
        logMsg('running on Windows platform');
        jsonData += ' "{\\"adminClientSecret\\":\\"<secret>\\"}" ';
      } else {
        logMsg('running on non-Windows platform');
        jsonData += " '{\"adminClientSecret\":\"<secret>\"}' ";
      }
      jsonData = jsonData.replace(/<secret>/g, getConfigVal('uaa_admin_client_secret'));
      logMsg(`jsonData=${jsonData}`);
      const uaaServiceInstance = getConfigVal('uaa_service_instance');
      const uaaGuid = await createPredixService('predix-uaa', plan, uaaServiceInstance, jsonData);

      // build the issuer ids json, which we'll use when creating the other services
      const issuerIdsJson = buildIssuerIdsJson(uaaServiceInstance, uaaGuid);

      // create time series service instance
      const timeSeriesServiceInstance = getConfigVal('time_series_service_instance');
      const timeSeriesGuid = await createPredixService('predix-timeseries', plan, timeSeriesServiceInstance,
        issuerIdsJson);

      // create asset service instance
      const assetServiceInstance = getConfigVal('asset_service_instance');
      const assetGuid = await createPredixService('predix-asset', plan, assetServiceInstance, issuerIdsJson);

      // update service instance GUIDs in config
      predixConfig.uaa_service_instance_guid = uaaGuid;
      predixConfig.time_series_service_instance_guid = timeSeriesGuid;
      predixConfig.asset_service_instance_guid = assetGuid;
      predixConfig.uaa_url = predixConfig.uaa_url_template.replace('<guid>', uaaGuid);

      // create client to use to access predix services
      await createPredixClient();

      // write out the configuration to the config file
      writeConfigToFile(predixConfig);

      logMsg('\n------------------------------------------');
      logMsg('setup completed successfully!');
    }
  } catch (err) {
    logMsg('Error occurred:', err);
  }
};

runSetup();

