import { ipcMain } from 'electron';
//const url = require('url');
const request = require('request-promise-native')
const AWS = require('aws-sdk')
const awsIot = require('aws-iot-device-sdk')
const path = require('path')

import { DiscoveryService } from './discoveryService';

let sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Provisioning service in main process
 */
export class ProvisioningService {

  discoveryService: DiscoveryService;

  constructor() {
    this.discoveryService = new DiscoveryService()
  }

  registerMainProcessIPC() {
    ipcMain.on('check-stack-endpoint-request', this.checkStackEndpoint.bind(this))
    ipcMain.on('provision-camera-request', this.provisionCamera.bind(this))
  }

  /**
   * @param args {stackEndpoint, provisioningKey}.
   */
  checkStackEndpoint(event, args) {
    console.log("main process received stack endpoint requests.")
    console.log(args)

    const url = (args.stackEndpoint || '').trim() + "/stack_availability"
    const Authorization = (args.provisioningKey || '').trim()
    console.log(url)
    request({
      url,
      method: 'get',
      headers: {
        Authorization
      }
    }).then(result => {
      console.log("Stack available.")
      console.log(result)
      event.sender.send('check-stack-endpoint-response', {})
    }).catch(err => {
      //403 response means invalid provisioning key.
      //No response means stack url is incorrect or inaccessible.
      console.log("Stack not available")
      console.log(err)
      console.log(err.name)
      console.log(err.statusCode)
      console.log(err.message)
      const error = err.statusCode == 403 ? 'provisioningKey' : 'stackEndpoint'
      event.sender.send('check-stack-endpoint-response', {error})
    })
  }

  /**
   * @param args {stackEndpoint, provisioningKey, camera}.
   * @returns {camera, error, errorMessage}
   */
  provisionCamera(event, args) {
    console.log("main process received provisiong camera request.")
    console.log(args)

    this.provisionCloudStep(event, args)
      .then(thing => this.provisionCameraStep(event, args, thing))
      .then(() => {
        console.log("Provisioning success.")
        event.sender.send('provision-camera-response', {camera: args.camera})
      })
      .catch(err => {
        console.log("Provisioning error.")
        args.camera.workflowError = true
        args.camera.workflowErrorMessage = `Provisioning failure in ${err.step} step: ${err.message}`
        event.sender.send('provision-camera-response', {camera: args.camera})
      })
  }


  async provisionCloudStep(event, args) {
    console.log("cloud step")
    const url = (args.stackEndpoint || '').trim() + "/provision"
    const Authorization = (args.provisioningKey || '').trim()
    const id = args.camera.urn
    const location = args.camera.location
    const gauge_info = args.camera.gauge_info
    const rate = args.camera.rate
    console.log(url)
    return request({
      url,
      method: 'post',
      headers: {
        Authorization
      },
      body: JSON.stringify({id, meta:{location, gauge_info, rate}})
    }).then(result => {
      console.log("Provisioning success in cloud step!")
      console.log(result)
      const thing = JSON.parse(result)
      return thing
    }).catch(err => {
      console.log("Provisioning failure in cloud step!")
      console.log(err)
      console.log(err.name)
      console.log(err.statusCode)
      console.log(err.message)
      err.step = "cloud"
      throw err
    })
  }

  async provisionCameraStep(event, args, thing) {
    console.log("camera step")

    const certPath = path.join(process.env.USERPROFILE || process.env.HOME, 'certs')
    const cred = new AWS.SharedIniFileCredentials()
    const client = awsIot.device({
      host: args.camera.ip,
      keyPath: path.join(certPath, 'f5e6003197.private.key'),
      certPath: path.join(certPath, 'f5e6003197.cert.pem'),
      caPath: path.join(certPath, 'root.ca.pem'),
      clientId: 'f5e6003197'
    })

    //camera Basic auth
    let Authorization = ''
    if (args.camera.cameraApiUsername.length > 0 || args.camera.cameraApiPassword.length > 0) {
      console.log("Including camera authentication.")
      Authorization = "Basic " + Buffer.from(`${args.camera.cameraApiUsername}:${args.camera.cameraApiPassword}`).toString('base64')
      console.log(Authorization)
    } else {
      console.log("Skipping camera authentication.")
    }

    var received = false
    client.on('message', function(topic, payload) {
      received = true
    })

    const message = JSON.stringify({authorization: Authorization})
    client.subscribe('deepgauge_model/authorization')
    client.publish('deepgauge_model/provision', message)

    await sleep(2000);

    if (received) {
      args.camera.status = 'PAIRED'
    }
    else {
      var err = { step: "camera", message: "Did not receive authorization" }
      throw err
    }
  }
}
