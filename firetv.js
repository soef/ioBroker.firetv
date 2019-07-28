"use strict";

var soef = require('soef'),
    adb = require('adbkit'),
    path = require('path'),
    Client = require('/opt/iobroker/node_modules/adbkit/lib/adb/client'),
    Mdns = require('mdns-discovery');

soef.extendAll();

Client.prototype.shellEx = function(id, command, cb) {
    //this.parent.shell.call( this, id, command, function (err, stream) {
    this.shell(id, command, function (err, stream) {
        if (err || !stream) return cb & cb(err, 0);
        adb.util.readAll(stream, function (err, output) {
            if (err || !stream) return cb && cb(err);
            var ar = output.toString().split('\r\n');
            ar.length--;
            for (var i=ar.length-1; i > ar.length-10; i++) {
                adapter.log.debug(ar[i]);
            }
            cb && cb(0, ar);
        });
    })
};

// Client.prototype.shell1 = function (id, command, cb) {
//     return this.shellEx(id, command, function (err, ar) {
//         cb && cb(err, (ar && ar.length) ? ar[0] : '');
//     });
// };

Client.prototype.getIP = function(id, cb) {
    var self = this;
    this.getProperties(id, function (err, properties) {
        if (!err && properties) {
            var ip = soef.getProp(properties, "dhcp.eth0.ipaddress");
            ip = ip || soef.getProp(properties, "dhcp.wlan0.ipaddress");
            if (ip) return cb && cb(0, ip);
        }
        self.shellEx(id, "ifconfig wlan0", function (err, ar) {
            if (err || !ar) return cb && cb('');
            ar.forEach(function (line) {
                var a = line.trim().split('  ');
                if (a && a.length) {
                    a = a[0].split(':');
                    if (a && a.length && a[0] === 'inet addr') {
                        ip = a [1];
                        if (ip) return cb && cb(ip);
                    }
                }
            });
            cb && cb('');
        });
    });
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var fireTVs = {};
var g_client;
var isWin = process.platform === 'win32';

var knownAppPathes = {
    kodi:     'org.xbmc.kodi/.Splash',
    xbmc:     'org.xbmc.kodi/.Splash',
    netflix:  'com.netflix.ninja',
    tvnow:    'de.cbc.tvnow.firetv/de.cbc.tvnowfiretv.MainActivity',
    nowtv:    'de.cbc.tvnow.firetv/de.cbc.tvnowfiretv.MainActivity',
    zdf:      'com.zdf.android.mediathek',
    ard:      'com.daserste.daserste',
    daserste: 'com.daserste.daserste'
};

//am start -n com.netflix.ninja
//am start -W -S -n com.netflix.ninja/.MainActivityam

var adapter = soef.Adapter (
    main,
    onStateChange,
    onUnload,
    onMessage,
    'firetv'
);

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var usedStateNames = {
    online:             { n: 'online',      val: false, common: { write: false, min: false, max: true }},
    startApp:           { n: 'startApp',    val: '',    common: { desc: 'start an application e.g.: com.netflix.ninja/.MainActivity'}},
    stopApp:            { n: 'stopApp',     val: '',    common: { desc: 'stops an application e.g.: com.netflix.ninja'}},
    sendKeyCode:        { n: 'sendKeyCode', val: 0,     common: { }},
    sendKeyCodeArray:   { n: '',            val: '',    common: { desc: 'Can be an array of keys and delays. e.g.: 4000, DOWN, 100, DOWN, DOWN, LEFT, ENTER, 5000, LEFT' }},
    reboot:             { n: 'reboot',      val: false, common: { min: false, max: true}},
    screencap:          { n: 'screencap',   val: false, common: { min: false, max: true}},
    result:             { n: 'result',      val: '',    common: { write: false }},
    swapPower:          { n: 'swapPower',   val: false, common: { min: false, max: true}},
    on:                 { n: 'on',          val: false, common: { min: false, max: true}},
    state:              { n: 'state',       val: '',    common: { }},
    shell:              { n: 'shell',       val: '',    common: { desc: 'send an adb shell command'}},
    text:               { n: 'text',        val: '',    common: { desc: 'send "text" to the device'}},
    sendevent:          { n: 'sendevent',   val: '',    common: { } },
    
    //framebuffer:        { n: 'framebuffer', val: '',    common: { } },
    
    enter:              { n: 'keys.enter',  val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_ENTER }},
    left:               { n: 'keys.left',   val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_DPAD_LEFT }},
    right:              { n: 'keys.right',  val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_DPAD_RIGHT }},
    up:                 { n: 'keys.up',     val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_DPAD_UP }},
    down:               { n: 'keys.down',   val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_DPAD_DOWN }},
    home:               { n: 'keys.home',   val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_HOME }},
    back:               { n: 'keys.back',   val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_BACK }},
    menu:               { n: 'keys.menu',   val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_MENU }},
    escape:             { n: 'keys.escape', val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_ESCAPE}}
};
for (var i in usedStateNames) {
    var o = usedStateNames[i];
    if (!o.n) o.n = i;
}


function prepareStates() {
    var o = {};
    for (var i in adb.Keycode) {
        o[adb.Keycode[i]] = i.substr(8);
    }
    usedStateNames.sendKeyCode.common.states = o;
}
prepareStates();

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function onStateChange(id, state) {
    var dcs = adapter.idToDCS(id);
    var ftv = fireTVs[dcs.device];
    if (ftv) {
        if (ftv.onStateChange(dcs.channel, dcs.state, state.val) === true) {
            ftv.dev.setImmediately(soef.ns.no(id), false);
        }
    }
}


function onMessage (obj) {
    if (!obj) return;
    switch (obj.command) {
        case 'discovery':
            var mdns = Mdns({
                timeout: 3,
                name: '_amzn-wplay._tcp.local',
                find: 'amzn.dmgr:'
            });
            mdns.setFilter('ip', adapter.config.devices).run (function(res) {
                if (obj.callback) {
                    res.forEach(function(v) {
                        v.enabled = true;
                    });
                    adapter.sendTo (obj.from, obj.command, JSON.stringify(res), obj.callback);
                }
            });
            return true;
        default:
            adapter.log.warn("Unknown command: " + obj.command);
            break;
    }
    if (obj.callback) adapter.sendTo (obj.from, obj.command, obj.message, obj.callback);
    return true;
}


function closeAllFireTVs() {
    for (var i in fireTVs) {
        fireTVs[i].close();
        delete fireTVs[i];
    }
    
}

function onUnload(callback) {
    closeAllFireTVs();
    g_client.close();
    callback && callback();
}

function new_g_client() {
    if (g_client) return;
    g_client = adb.createClient({bin: adapter.config.adbPath});
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function trackDevices() {
    
    function set(device, val) {
        if (!device || !device.id) return;
        var ar = device.id.split(':');
        var ftv = fireTVs[normalizedName(ar[0])];
        if (ftv) {
            ftv.setOnline(val);
            ftv.updatePowerState();
            ftv.updateState();
        }
    }
    new_g_client();
    g_client.trackDevices()
        .then(function (tracker) {
            tracker.on('add', function (device) {
                set(device, true);
                adapter.log.debug('Device ' + device.id + ' + type=' + device.type + ' was plugged in');
            });
            tracker.on('remove', function (device) {
                set(device, false);
                adapter.log.debug('Device ' + device.id + ' was unplugged');
            });
            tracker.on('end', function () {
                adapter.log.debug('Tracking stopped');
            });
        })
        .catch(function (err) {
            adapter.log.debug('Something went wrong:' + err.message)
        })
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var FireTV = function (entry) {
    this.dev = new devices.CDevice(entry.ip, entry.name);
    this.id = entry.ip;
    adapter.log.debug("FireTV: " + entry.ip);
    var d = this.dev.getFullId('');
    fireTVs [d] = this;
};


FireTV.prototype.startClient = function(cb) {
    var self = this;
    this.client = adb.createClient({ bin: adapter.config.adbPath });
    this.client.connect(this.id, 5555, function(err, id) {
        if (err || !id) {
            adapter.log.error('can not connect to ' + self.id + ' Error=' + err.message);
            return;
        }
        self.client.id = id;
        self.client.getState(id, function(err,state) {
            adapter.log.debug('Connected to ' + self.id + ' id=' + id + ((!err && state) ? ' state=' + state : ""));
            self.updateState(state);
        });
    
        // self.client.getProperties(id, function(err, properties) {
        // });
        // self.client.getPackages(id, function(err, packages) {
        //     if (err || !packages) return;
        // });
    
        self.client.version(function(err, version) {
            self.getAndroidVersion(function(androidVersion) {
                self.getAPILevel(function (apiLevel) {
                    soef.log("%s: ADB version: %s, Android Version: %s, API Level: %s", self.id, version, androidVersion, apiLevel);
                });
            });
        });
        self.updatePowerState();
    });
    cb && cb();
};


FireTV.prototype.createStates = function (cb) {
    for (var j in usedStateNames) {
        var st = Object.assign({}, usedStateNames[j]);
        this.dev.createNew(st.n, st);
    }
    devices.update(function() {
        this.startClient(cb);
    }.bind(this));
};


FireTV.prototype.close = function() {
    if (this.client && this.client.id) {
        this.client.disconnect(this.client.id).catch(function (err) {
            adapter.log.debug('Something went wrong:' + err.message)
        });
        this.client.kill(function(err) {
             if (err) adapter.log('error killing adb server: ' + err.message);
        });
        this.client = undefined;
    }
};

FireTV.prototype.getAndroidVersion = function (cb) {
    return this.shell1('getprop ro.build.version.release', cb);
};

FireTV.prototype.getAPILevel = function (cb) {
    return this.shell1('getprop ro.build.version.sdk', cb);
};

FireTV.prototype.setOnline = function (online) {
    this.dev.setImmediately(usedStateNames.online.n, !!online);
};


FireTV.prototype.handleCallback = function (err, stream, cb) {
    if (err || !stream) {
        adapter.log.error('ID: ' + this.id + ' Error=' + err.message);
        if (err && err.message) this.dev.setImmediately('error', err.message);
        return cb && cb();
    }
    var self = this;
    adb.util.readAll(stream, function(err, output) {
        if (!err && output) {
            var ar = output.toString().split('\r\n');
            ar.length--;
            // for (var i = Math.max(0, ar.length-10); i < ar.length; i++) {
            //     var line = ar[i];
            //     adapter.log.debug(line);
            //     self.dev.setImmediately('result', line);
            // }
            if (ar.length < 10) ar.forEach(function (line) {
                adapter.log.debug(line);
                self.dev.setImmediately('result', line);
            });
        }
        if (cb) cb (ar);
    });
};


FireTV.prototype.shell1 /*Line*/ = function (cmd, cb) {
    this.shell (cmd, function(ar) {
        if (ar && ar.length) return cb && cb(ar[0]);
        cb && cb('');
    })
};

FireTV.prototype.shell = function (command, cb) {
    if (!this.client || !this.client.id) return cb && cb('client.id not set');
    this.client.shell(this.client.id, command, function(err, stream) {
        this.handleCallback(err, stream, cb);
    }.bind(this));
};


function lines2Object(lines) {
    var o = {};
    if (!lines) return o;
    if (typeof lines === 'string') lines = lines.split('\r\n');
    lines.forEach(function(line) {
        line = line.trim().replace(/ |:/g, '_');
        var ar = line.split('=');
         if (ar && ar.length >= 2) {
             o [ar[0]] = valtype(ar[1]);
         }
    });
    return o;
}


FireTV.prototype.updatePowerState = function (cb) {
    this.getPowerState(function (on) {
        this.dev.setImmediately(usedStateNames.on.n, on);
        cb && cb(on);
    }.bind(this));
};
FireTV.prototype.updateState = function (state) {
    this.dev.setImmediately(usedStateNames.state.n, state);
};


FireTV.prototype.getPowerState = function (cb) {
    this.shell('dumpsys power', function (ar) {
        // var value = ar.join('\r');
        // var RE_KEYVAL = /^\s*(\S*)=(\S)\r?$/gm;
        // var properties = {};
        // var match;
        // value = value.substr(52);
        // while (match = RE_KEYVAL.exec(value)) {
        //     properties[match[1]] = match[2];
        // }

        var power = lines2Object(ar);
        var on = power.Display_Power__state;
        //var i = power.mScreenOn;
        // power.mSystemReady
        // power.mDisplayReady;
        cb && cb(on === 'ON');
    });
};


function getKeyValue(key) {
    var val = ~~key;
    if (val) return val;
    key = key.replace(/"|'|\s/g, '').toUpperCase();
    
    if ((val = adb.Keycode[key]) !== undefined) return val;
    if ((val = adb.Keycode['KEYCODE_DPAD_' + key]) !== undefined) return val;
    val = adb.Keycode['KEYCODE_' + key];
    return val;
}


function buildInputEvent(key, longpress) {
    key = getKeyValue(key);
    var SEP = ' && ';
    //var SEP = '\n';
    var eventNo = 7;
    var cmd =
        //"sendevent /dev/input/event" + eventNo + " 4 4 0007004f" + SEP +
        "sendevent /dev/input/event" + eventNo + " 1 " + key + " 1" + SEP +
        "sendevent /dev/input/event" + eventNo + " 0 0 0" + SEP;
    if (longpress) cmd += 'sleep 1';
    cmd +=
        //"sendevent /dev/input/event" + eventNo + " 4 4 0007004f" + SEP +
        "sendevent /dev/input/event" + eventNo + " 1 " + key + " 0" + SEP +
        "sendevent /dev/input/event" + eventNo + " 0 0 0";
    
    return cmd;
}


var reInputKey = /^[\"|\'](.*)[\"|\']$/;

FireTV.prototype.inputKeyevent = function (val) {
    if (~~val !== 0) return this.shell("input keyevent " + val);
    
    // (4000, 'DOWN', 1000, 'DOWN', 100, 'DOWN', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'ENTER', 500, 'DOWN');
    var ar = val.split(',');
    if (ar.length <= 1) ar = val.split(' ');
    var number, i = 0, delay = 0;
    var self = this;
    //self.stopKeyevents
    
    function doIt() {
        if (i < ar.length && !self.stopKeyevents) {
            var v = ar[i++].trim();
            if ((number = ~~v)) {
                //adapter.log.debug('sendKeys: number, delay=' + v);
                delay = number;
                setTimeout (doIt, delay);
            } else {
                //adapter.log.debug('sendKeys: ' + v + ' (' + keys[v] + ')');
                var key;
                if (reInputKey.test(v)) {
                    
                    key = "input text " + normalizeInputText(v.replace(reInputKey, '$1'));
                } else if (v === 'callback') {
                    self.dev.setImmediately('result', 'callback');
                } else {
                    key = "input keyevent " + getKeyValue(v);
                }
                //console.log('Sending: ' + key + ' i=' + i);
                self.shell( key, function(lines) {
                    if (i <ar.length && ~~ar[i] > 0) doIt();
                    else setTimeout(doIt, delay);
                });
            }
        }
        if (self.stopKeyevents) self.stopKeyevents--;
    }
    doIt();
};


FireTV.prototype.frameBuffer = function (val) {
    this.client.framebuffer(this.client.id, 'raw', function(err, stream) {
        if (err || !stream) return;
        adb.util.readAll(stream, function(err, output) {
            err = err;
        });
    });
};

function normalizeInputText(t) {
    return t.toString().replace(/\s/g, '%s');
}

FireTV.prototype.onStateChange = function (channel, state, val) {
    var self = this;
    switch(channel) {
        case 'framebuffer':
            this.frameBuffer(val);
            break;
        case usedStateNames.shell.n:
            this.shell(val);
            break;
        case usedStateNames.text.n:
            val = val.replace(/\s/g, '%s');
            this.shell('input text ' + normalizeInputText(val));
            break;
        case 'keys':
            var code = usedStateNames[state].common.code;
            this.shell("input keyevent " + code);
            return true;
        case usedStateNames.startApp.n:
            var appPath = knownAppPathes[val.toLowerCase()];
            if (!appPath) appPath = val;
            var ar = appPath.split('/');
            if (ar.length < 2) appPath += '/.MainActivity';
            this.shell('am start -n ' + appPath);
            break;
        case usedStateNames.stopApp.n:
            var appPath = knownAppPathes[val.toLowerCase()];
            if (!appPath) appPath = val;
            var ar = appPath.split('/');
            this.shell('am force-stop ' + ar[0]);
            break;
        case 'sendevent':
        case usedStateNames.sendKeyCodeArray.n:
        case usedStateNames.sendKeyCode.n:
            this.inputKeyevent(val);
            //this.shell("input keyevent " + val);
            break;
        case usedStateNames.reboot.n:
            this.client.reboot(this.client.id, this.handleCallback.bind(this));
            break;
        case usedStateNames.screencap.n:
            this.client.screencap(this.client.id, this.handleCallback.bind(this));
            break;
        case usedStateNames.swapPower.n:
            this.shell("input keyevent " + adb.Keycode.KEYCODE_POWER);
            return true;
        case 'power':
        case usedStateNames.on.n:
            this.getPowerState(function(on) {
                if (val !== on) this.shell("input keyevent " + adb.Keycode.KEYCODE_POWER);
            }.bind(this));
            break;
    }
};


function checkIP(cb) {
    if (adapter.config.devices.length) cb && cb();
    cb = undefined;
    var mdns = Mdns({
        timeout: 4,
        //returnOnFirstFound: true,
        name: '_amzn-wplay._tcp.local',
        find: 'amzn.dmgr:'
    });
    mdns.run (function(res) {
        res.removeDup('ip', adapter.config.devices);
        if (!res.length) return cb && cb();
        soef.changeAdapterConfig(adapter, function(config){
            res.forEach(function(dev) {
                if (!config.devices.find(function(v) {
                    return v.ip === dev.ip;
                })) {
                    config.devices.push({
                        enabled: true,
                        name: dev.name,
                        ip: dev.ip
                    })
                }
            });
            if (config.devices.length !== adapter.config.devices.length) {
                adapter.config.devices = config.devices;
                if (cb === undefined) {
                   closeAllFireTVs();
                   startFireTVs();
                }
            }
        }, cb );
    });
}


function checkPATH() {
    var fn, ar = process.env.PATH.split(path.delimiter);
    var exe = isWin ? 'adb.exe' : 'adb';
    ar.find(function(v) {
        if (v.toLowerCase().indexOf('adb') >= 0) {
            var _fn = path.join(v, exe);
            if (soef.existFile(_fn)) {
                fn = _fn;
                return true;
            }
        }
        return false;
    });
    return fn;
}

var defaultMinimalABAndFastboot = 'C:/Program Files (x86)/Minimal ADB and Fastboot/adb.exe';
function normalizeConfig() {
    var oldAdbPath = adapter.config.adbPath;
    if (!soef.existFile(adapter.config.adbPath)) {
        if (isWin && adapter.config.adbPath && soef.existFile(adapter.config.adbPath + '.exe')) {
            adapter.config.adbPath += '.exe';
        } else {
            var p = adapter.config.adbPath + '/adb';
            p = p.replace(/\\/g, '/').replace(/\/\//g, '/');
            if (!isWin && soef.existFile(p)) {
                adapter.config.adbPath = p;
            } else if (isWin && soef.existFile(p + '.exe')) {
                adapter.config.adbPath = p + '.exe';
            } else if (isWin && soef.existFile(defaultMinimalABAndFastboot)) {
                adapter.config.adbPath = defaultMinimalABAndFastboot;
            } else {
                adapter.config.adbPath = checkPATH();
                if (!adapter.config.adbPath) {
                    adapter.log.error('adb executable not found. ' + adapter.config.adbPath);
                    adapter.config.adbPath = 'adb'
                }
            }
        }
        adapter.config.adbPath = path.normalize(adapter.config.adbPath);
    }
    if (oldAdbPath !== adapter.config.adbPath || adapter.config.devices.unique('ip')) {
        soef.changeAdapterConfig(adapter, function(config) {
            config.devices = adapter.config.devices;
            config.adbPath = adapter.config.adbPath;
        });
    }
 }
 
 
function startFireTVs(cb) {
    var i = 0;
    function doIt() {
        if (i >= adapter.config.devices.length) return cb && cb();
        var device = adapter.config.devices[i++];
        if (device.enabled) {
            var firetv = new FireTV(device);
            firetv.createStates(doIt);
        } else {
            doIt();
        }
    }
    doIt();
}


function prepareDevices(cb) {
    var re = /^\d*\.\d*\.\d*\.\d*:\d*$/;
    new_g_client();
    g_client.listDevices(function (err, devices) {
        if (err || !devices) return cb && cb(err);
        devices.forEach(function (device) {
            if (!re.test(device.id)) g_client.tcpip(device.id, function (err, port) {
                if (err || !port) return cb && cb(err);
                g_client.waitForDevice(device.id, function(err, data) {
                    g_client.getIP(device.id, function(ip) {
                        if (ip) g_client.connect(ip, port, function(err,data) {
                            cb && cb(err);
                        });
                    });
                });
            });
        })
    })
}


function main() {
    
    normalizeConfig();
    prepareDevices();
    
    soef.deleteOrphanedDevices('ip', adapter.config.devices);
    checkIP(function () {
        startFireTVs(function () {
            trackDevices();
        })
    });
    
    adapter.subscribeStates('*');
    //adapter.subscribeObjects('*');
}

