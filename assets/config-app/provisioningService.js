"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = y[op[0] & 2 ? "return" : op[0] ? "throw" : "next"]) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [0, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var electron_1 = require("electron");
//const url = require('url');
var request = require('request-promise-native');
var AWS = require('aws-sdk');
var awsIot = require('aws-iot-device-sdk');
var path = require('path');
var discoveryService_1 = require("./discoveryService");
var sleep = function (ms) { return new Promise(function (resolve) { return setTimeout(resolve, ms); }); };
/**
 * Provisioning service in main process
 */
var ProvisioningService = /** @class */ (function () {
    function ProvisioningService() {
        this.discoveryService = new discoveryService_1.DiscoveryService();
    }
    ProvisioningService.prototype.registerMainProcessIPC = function () {
        electron_1.ipcMain.on('check-stack-endpoint-request', this.checkStackEndpoint.bind(this));
        electron_1.ipcMain.on('provision-camera-request', this.provisionCamera.bind(this));
    };
    /**
     * @param args {stackEndpoint, provisioningKey}.
     */
    ProvisioningService.prototype.checkStackEndpoint = function (event, args) {
        console.log("main process received stack endpoint requests.");
        console.log(args);
        var url = (args.stackEndpoint || '').trim() + "/stack_availability";
        var Authorization = (args.provisioningKey || '').trim();
        console.log(url);
        request({
            url: url,
            method: 'get',
            headers: {
                Authorization: Authorization
            }
        }).then(function (result) {
            console.log("Stack available.");
            console.log(result);
            event.sender.send('check-stack-endpoint-response', {});
        }).catch(function (err) {
            //403 response means invalid provisioning key.
            //No response means stack url is incorrect or inaccessible.
            console.log("Stack not available");
            console.log(err);
            console.log(err.name);
            console.log(err.statusCode);
            console.log(err.message);
            var error = err.statusCode == 403 ? 'provisioningKey' : 'stackEndpoint';
            event.sender.send('check-stack-endpoint-response', { error: error });
        });
    };
    /**
     * @param args {stackEndpoint, provisioningKey, camera}.
     * @returns {camera, error, errorMessage}
     */
    ProvisioningService.prototype.provisionCamera = function (event, args) {
        var _this = this;
        console.log("main process received provisiong camera request.");
        console.log(args);
        this.provisionCloudStep(event, args)
            .then(function (thing) { return _this.provisionCameraStep(event, args, thing); })
            .then(function () {
            console.log("Provisioning success.");
            event.sender.send('provision-camera-response', { camera: args.camera });
        })
            .catch(function (err) {
            console.log("Provisioning error.");
            args.camera.workflowError = true;
            args.camera.workflowErrorMessage = "Provisioning failure in " + err.step + " step: " + err.message;
            event.sender.send('provision-camera-response', { camera: args.camera });
        });
    };
    ProvisioningService.prototype.provisionCloudStep = function (event, args) {
        return __awaiter(this, void 0, void 0, function () {
            var url, Authorization, id, location, gauge_info, rate;
            return __generator(this, function (_a) {
                console.log("cloud step");
                url = (args.stackEndpoint || '').trim() + "/provision";
                Authorization = (args.provisioningKey || '').trim();
                id = args.camera.urn;
                location = args.camera.location;
                gauge_info = args.camera.gauge_info;
                rate = args.camera.rate;
                console.log(url);
                return [2 /*return*/, request({
                        url: url,
                        method: 'post',
                        headers: {
                            Authorization: Authorization
                        },
                        body: JSON.stringify({ id: id, meta: { location: location, gauge_info: gauge_info, rate: rate } })
                    }).then(function (result) {
                        console.log("Provisioning success in cloud step!");
                        console.log(result);
                        var thing = JSON.parse(result);
                        return thing;
                    }).catch(function (err) {
                        console.log("Provisioning failure in cloud step!");
                        console.log(err);
                        console.log(err.name);
                        console.log(err.statusCode);
                        console.log(err.message);
                        err.step = "cloud";
                        throw err;
                    })];
            });
        });
    };
    ProvisioningService.prototype.provisionCameraStep = function (event, args, thing) {
        return __awaiter(this, void 0, void 0, function () {
            var certPath, cred, client, Authorization, received, message, err;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log("camera step");
                        certPath = path.join(process.env.USERPROFILE || process.env.HOME, 'certs');
                        cred = new AWS.SharedIniFileCredentials();
                        client = awsIot.device({
                            host: args.camera.ip,
                            keyPath: path.join(certPath, 'f5e6003197.private.key'),
                            certPath: path.join(certPath, 'f5e6003197.cert.pem'),
                            caPath: path.join(certPath, 'root.ca.pem'),
                            clientId: 'f5e6003197'
                        });
                        Authorization = '';
                        if (args.camera.cameraApiUsername.length > 0 || args.camera.cameraApiPassword.length > 0) {
                            console.log("Including camera authentication.");
                            Authorization = "Basic " + Buffer.from(args.camera.cameraApiUsername + ":" + args.camera.cameraApiPassword).toString('base64');
                            console.log(Authorization);
                        }
                        else {
                            console.log("Skipping camera authentication.");
                        }
                        received = false;
                        client.on('message', function (topic, payload) {
                            received = true;
                        });
                        message = JSON.stringify({ authorization: Authorization });
                        client.subscribe('deepgauge_model/authorization');
                        client.publish('deepgauge_model/provision', message);
                        return [4 /*yield*/, sleep(2000)];
                    case 1:
                        _a.sent();
                        if (received) {
                            args.camera.status = 'PAIRED';
                        }
                        else {
                            err = { step: "camera", message: "Did not receive authorization" };
                            throw err;
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    return ProvisioningService;
}());
exports.ProvisioningService = ProvisioningService;
//# sourceMappingURL=provisioningService.js.map