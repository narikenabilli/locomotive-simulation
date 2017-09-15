/*
 * Copyright (C) 2017 TopCoder Inc., All Rights Reserved.
 */
/**
 * This module contains the steam locomotive simulator. It will simulate events for
 * a steam locomotive over a period of time, and will send data related to those
 * events to Predix time series and asset services.
 *
 * The user is expected to run the setup utility before running the simulator, and
 * that utility can be run using 'npm run setup'. After the simulator has been run,
 * the user can run the verification utility using 'npm run verify' to get the
 * data that was sent to Predix.
 */

'use strict';

const fs = require('fs');
const Promise = require('bluebird');
const Helper = require('./common/helper');
const TimeSeriesService = require('./services/time_series_service');
const AssetService = require('./services/asset_service');
const _ = require('lodash');
const constants = require('../config/simulator_constants');
const logger = require('./common/logger')(constants.SIMULATOR_LOGFILE_NAME, true);

// the predix configuration object
let predixConfig;

// the number of simulator iterations completed so far
let numIterations = 0;

// service instances for communicating with predix
let timeSeriesService;
let assetService;

// the model used for the simulator
const model = {
  /**
   * Specifies both the set of variables describing the state of
   * the system, and their initial values.
   */
  state: {
    // the distance in meters the locomotive has travelled
    distance: 0.0,

    // the mass in kg of fuel current burning
    fuelMassBurning: 0.0,

    // the mass in kg of fuel in the tender
    fuelMassInTender: constants.INITIAL_FUEL_MASS_IN_TENDER,

    // the mass in kg of fuel in the fire chamber
    fuelMassInFireChamber: 0.0,

    // the mass in kg of the locomotive
    locomotiveOwnMass: constants.LOCOMOTIVE_OWN_MASS,

    // the locomotive pressure (measured in bar)
    pressure: 0.0,

    // the speed of the locomotive in meters per second
    speed: 0.0,

    // the time in seconds that the locomotive has been travelling
    time: 0.0,
  },

  /**
   * Use to keep track of last time data was sent to predix time series,
   * asset service, etc.
   */
  history: {},

  /**
   * The array of processes used for the simulation.
   * Transition functions define the simulated process for the locomotive.
   */
  processes: [
    {
      /**
       * Emulates the fireman. In our simple model he just moves
       * the fuel from tender into the fire chamber.
       */
      name: 'Fireman',
      transferFunction: (state) => {
        if (state.fuelMassInTender < 0.0 || state.fuelMassInFireChamber > constants.MAX_FUEL_MASS_IN_FIRE_CHAMBER) {
          return state;
        }
        // return the updated state
        return {
          ...state,
          fuelMassInTender: state.fuelMassInTender - constants.FUEL_ADD_AMT,
          fuelMassInFireChamber: state.fuelMassInFireChamber + constants.FUEL_ADD_AMT,
        };
      },
    },
    {
      /**
       * An oversimplified model of fire chamber and boiler:
       * - Fuel added into fire chamber slowly becomes burning;
       * - Burning fuel is consumed (disappears) slowly;
       * - Pressure in boiler is just proportional to the amount
       *   of burning fuel (so we don't care about the boiler model
       *   for now).
       */
      name: 'Fire Chamber',
      transferFunction: (state) => {
        const res = { ...state };
        if (res.fuelMassBurning < res.fuelMassInFireChamber) {
          res.fuelMassBurning = Math.min(res.fuelMassInFireChamber, constants.FUEL_ADD_AMT + res.fuelMassBurning);
        }
        // calculate the new state values
        res.pressure = constants.PRESSURE_MULTIPLIER * res.fuelMassBurning;
        res.fuelMassBurning = Math.max(0, res.fuelMassBurning - constants.FUEL_BURN_AMT);
        res.fuelMassInFireChamber = Math.max(0, res.fuelMassInFireChamber - constants.FUEL_BURN_AMT);
        return res;
      },
    },
    {
      /**
       * The rest of the model. Assumes that locomotive acceleration
       * is proportional to the pressure in boiler, updates its
       * position, speed, world time.
       */
      name: 'Movement',
      transferFunction: (state) => {
        // a is the acceleration, calculated as the difference between the force created by engine and any work lost
        // due to friction, whatever.
        const mass = state.locomotiveOwnMass + state.fuelMassInTender + state.fuelMassInFireChamber;
        let a = ((constants.X1 * state.pressure) - (constants.X2 * state.speed)) / mass;
        if (numIterations % constants.LOG_INTERVAL === 0) {
          logger.logDebug(`in transferFunction, a = ${a}, mass = ${mass}`);
        }
        // keep acceleration within a valid range
        if ((state.speed === 0.0) && (Math.abs(a) < constants.X3)) {
          a = 0.0;
        }

        // return the updated state
        return {
          ...state,
          speed: state.speed + (constants.DT * a),
          distance: state.distance + (constants.DT * state.speed),
          time: state.time + constants.DT,
        };
      },
    },
  ],

  /**
   * Configuration of the time series service call and the alerts to be sent to the Predix asset
   * service.
   */
  onStateChange: [
    // send the state to Predix time series
    state => model.toTimeSeries(state),

    // send alert to Predix asset service if maximum pressure has been exceeded
    state => (state.pressure > constants.MAX_ALLOWED_PRESSURE ?
      model.toAsset('pressure', state.pressure, 'Maximum pressure has been exceeded!') : undefined),

    // send alert to Predix asset service if maximum speed has been exceed
    state => (state.speed > constants.MAX_ALLOWED_SPEED ?
      model.toAsset('speed', state.speed, 'Maximum speed has been exceeded!') : undefined),

    // send alert to Predix asset service if fuelMassInTender is too low
    state => (state.fuelMassInTender < constants.MIN_ALLOWED_FUEL_MASS_IN_TENDER ?
      model.toAsset('fuelMassInTender', state.fuelMassInTender, 'Fuel mass in tender is too low!') : undefined),

  ],

  /**
   * Sends data to Predix time series service
   * @param {Object} state the state to send to the Predix time series service
   * @returns {Object} a Promise which will resolve once data has been queued to be sent to Predix
   */
  toTimeSeries: state => model.sendDataToPredix('timeSeries', state, timeSeriesService.sendDataToPredix,
    'timeSeriesService.sendDataToPredix', 'time series'),

  /**
   * Sends data to Predix asset service.
   * @param {string} key the key of the data to send to asset service
   * @param {Object} val the asset value (ex: speed)
   * @param {string} msg the alert message to send to the asset service (ex: "Maximum speed has been exceeded!")
   * @returns {Object} a Promise which will resolve once data has been queued to be sent to Predix
   */
  toAsset: (key, val, msg) =>
    model.sendDataToPredix(key, { key, val, time: state.time, msg }, assetService.sendDataToPredix, // eslint-disable-line
      'assetService.sendDataToPredix', 'asset'),

  /**
   * Sends data to Predix service (time series or asset)
   * @param {string} key the key of the data to send
   * @param {Object} data the data to send
   * @param {Function} sendData the method to call to send the data
   * @param {string} methodName the name of the method using for sending the data
   * @param {string} typeOfService the type of Predix service to which data is being set
   * @returns {Object} a Promise which will resolve once data has been queued to be sent to Predix
   */
  sendDataToPredix: (key, data, sendData, methodName, typeOfService) => Promise.try(() => {
    // determine if we need to send the data to predix service - we send it if these conditions are met:
    // 1) we haven't sent data MAX_NUM_SENDS_PER_KEY times or more
    // 2) the time difference between state.time and the last send is >= SEND_INTERVAL
    const numSends = _.isUndefined(model.history[key]) ? 0 : model.history[key].numSends;
    const timeDiff = _.isUndefined(model.history[key]) ? -1 :
      state.time - model.history[key].prevTimeSent;  // eslint-disable-line

    if (numSends < constants.MAX_NUM_SENDS_PER_KEY &&
      (timeDiff === -1 || timeDiff + constants.EPS >= constants.SEND_INTERVAL)) {
      logger.logDebug(`sending data to predix: timeDiff = ${timeDiff}, numSends = ${numSends}, key = ${key}, ` +
        `data = ${JSON.stringify(data)}`);

      // send the data to predix!
      logger.logDebug('calling ' + methodName);
      sendData(data);
      logger.logDebug('back from call to ' + methodName);

      // update history for sent data so we can determine when this type of data needs to be sent again
      if (_.isUndefined(model.history[key])) {
        // first time we've sent this data, so create a new history object
        model.history[key] = {
          prevTimeSent: state.time,  // eslint-disable-line
          numSends: 1,
        };
      } else {
        // update existing history object
        model.history[key] = {
          prevTimeSent: state.time,  // eslint-disable-line
          numSends: model.history[key].numSends + 1,
        };
      }
    }
    // everything worked!
    return 'success';
  }).catch((e) => {
    logger.logError('Error sending data to predix %s: %j', typeOfService, e);
  }),
};

// initial state
let state = model.state;

/**
 * Called once simulation is finished. Displays statistics to user about data
 * sent to Predix.
 */
const finishSimulation = () => {
  // make sure the services have finished sending all data to Predix
  if (timeSeriesService.isFinished() && assetService.isFinished()) {
    // services have finished their work, so display some final stats
    logger.logInfo('----------- SIMULATION COMPLETE -----------');
    logger.logInfo(`total time series states sent to predix = ${timeSeriesService.getTotalRequestsSent()}`);
    logger.logInfo(`total asset requests sent to predix = ${assetService.getTotalRequestsSent()}`);
  } else {
    if (!timeSeriesService.isFinished()) {
      logger.logDebug('In finishSimulation, time series service not finished yet');
    }
    if (!assetService.isFinished()) {
      logger.logDebug('In finishSimulation, asset service not finished yet');
    }
    // services have not finished their work, so wait a bit then check again
    const WAIT_INTERVAL_MS = 350; // wait interval in milliseconds
    setTimeout(finishSimulation, WAIT_INTERVAL_MS);
  }
};

/**
 * The simulation method for the locomotive.
 */
const runSimulation = async () => {
  // log if needed
  if (numIterations % constants.LOG_INTERVAL === 0) {
    logger.logDebug('------------------------------------');
    logger.logDebug(`entered runSimulation, numIterations = ${numIterations}`);
  }

  // during initial iteration, we need to initialize some things
  if (numIterations === 0) {
    // get token to use with predix services
    const token = await Helper.getPredixToken(predixConfig.uaa_url, predixConfig.client_id, predixConfig.client_secret);

    // create service instances
    timeSeriesService = new TimeSeriesService(token, logger);
    assetService = new AssetService(token, logger);
  }

  // see if we're done yet
  if (numIterations >= constants.NUM_ITERATIONS) {
    finishSimulation();
    return;
  }
  ++numIterations;

  // run the transfer functions to transfer current state to next state
  model.processes.forEach((process) => {
    state = process.transferFunction(state);
  });

  // log the state every LOG_INTERVAL iterations
  if (numIterations % constants.LOG_INTERVAL === 0) {
    logger.logDebug(`state = ${JSON.stringify(state)}`);
  }

  // create array of promises for all the onStateChange functions
  const promises = [];
  model.onStateChange.forEach(func => promises.push(func(state)));

  // wait for the state change functions to complete, then start another simulation iteration
  Promise.all(promises).then(() => {
    // give other events time to process before performing next iteration
    process.nextTick(runSimulation);
  }).catch((e) => {
    logger.logError('Error when processing state change events: %j', e);
  });

  // log if necessary
  if (numIterations % constants.LOG_INTERVAL === 0) {
    logger.logDebug('leaving runSimulation');
  }
};

// make sure setup was run before starting the simulation (e.g. config file will exist if setup was run successfully)
if (!fs.existsSync('./config/predix_config.json')) {
  logger.logError('--------------------------');
  logger.logError('The ./config/predix_config.json file was not found. You must run "npm run setup" before running ' +
    'the simulator');
  logger.logError('--------------------------');
  process.exit(1);
}

// load the Predix configuration which contains the Predix service names, GUIDs, etc.
predixConfig = require('../config/predix_config.json');

// go!
runSimulation();

