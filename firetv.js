"use strict";

var soef = require('soef'),
    adb = require('adbkit'),
    Mdns = require('mdns-discovery');

soef.extendAll();

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var fireTVs = {};
var g_client;

var knownAppPathes = {
    kodi: 'org.xbmc.kodi/.Splash',
    netflix: 'com.netflix.ninja'
};

var adapter = soef.Adapter (
    main,
    onStateChange,
    onUnload,
    onMessage,
    {
        name: 'firetv',
    }
);

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var usedStateNames = {
    online:      { n: 'online',      val: false, common: { write: false, min: false, max: true }},
    startApp:    { n: 'startApp',    val: '',    common: { desc: 'start an application e.g.: com.netflix.ninja/.MainActivity'}},
    stopApp:     { n: 'stopApp',     val: '',    common: { desc: 'stops an application e.g.: com.netflix.ninja'}},
    sendKeyCode: { n: 'sendKeyCode', val: 0,     common: { }},
    reboot:      { n: 'reboot',      val: false, common: { min: false, max: true}},
    screencap:   { n: 'screencap',   val: false, common: { min: false, max: true}},
    result:      { n: 'result',      val: '',    common: { write: false }},
    swapPower:   { n: 'swapPower',   val: false, common: { min: false, max: true}},
    
    enter:       { n: 'keys.enter',  val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_ENTER }},
    left:        { n: 'keys.left',   val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_DPAD_LEFT}},
    right:       { n: 'keys.right',  val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_DPAD_RIGHT}},
    up:          { n: 'keys.up',     val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_DPAD_UP}},
    down:        { n: 'keys.down',   val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_DPAD_DOWN}},
    home:        { n: 'keys.home',   val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_HOME}},
    back:        { n: 'keys.back',   val: false, common: { min: false, max: true, code: adb.Keycode.KEYCODE_BACK}},
    
};


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


function onUnload(callback) {
    Object.keys(fireTVs).forEach(function(v) {
        fireTVs[v].close();
        delete fireTVs[v];
    });
    g_client.close();
    callback && callback();
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function trackDevices() {
    
    function set(device, val) {
        var ar = device.id.split(':');
        var ftv = fireTVs[ar[0]];
        if (ftv) ftv.setOnline(val);
    }
    
    g_client = adb.createClient({bin: adapter.config.adbPath});
    
    g_client.trackDevices()
        .then(function (tracker) {
            tracker.on('add', function (device) {
                set(device, true);
                adapter.log.debug('Device ' + device.id + ' was plugged in');
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
            adapter.log.debug('Something went wrong:' + err.stack)
        })
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var FireTV = function (entry) {
    this.dev = new devices.CDevice(entry.ip, entry.name);
    this.id = entry.ip;
    var d = this.dev.getFullId('');
    fireTVs [d] = this;
};


FireTV.prototype.startClient = function(cb) {
    this.client = adb.createClient({ bin: adapter.config.adbPath });
    this.client.connect(this.id, 5555, function(err,d) {
        this.client.id = d;
        this.client.version(function(err, version) {
            adapter.log.info("adb version is " + version);
        });
        // this.client.getDevicePath(d, function(err, path) {
        // });
        // this.client.getFeatures(d, function(err, features) {
        // });
        cb && cb();
    }.bind(this));
};

FireTV.prototype.close = function() {
     if (this.client) {
         this.client.disconnect(this.client.id);
         this.client = undefined;
     }
};

FireTV.prototype.setOnline = function (online) {
    this.dev.setImmediately(usedStateNames.online.n, online ? true : false);
};

FireTV.prototype.create = function (cb) {
    this.dev.setDevice(this.id, {common: {name: this.id, role: 'device'}, native: { } });
    for (var j in usedStateNames) {
        var st = Object.assign({}, usedStateNames[j]);
        this.dev.createNew(st.n, st);
    }
    devices.update(function() {
        this.startClient(cb);
    }.bind(this));
};


FireTV.prototype.handleCallback = function (err, stream, cb) {
    if (err || !stream) return cb && cb();
    var self = this;
    adb.util.readAll(stream, function(err, output) {
        var ar = output.toString().split('\r\n');
        ar.length--;
        ar.forEach(function(line) {
            adapter.log.debug(line);
            self.dev.setImmediately('result', line);
        });
        if (cb) cb (ar);
    });
};

FireTV.prototype.shell = function (command, cb) {
    this.client.shell(this.client.id, command, function(err, stream) {
        this.handleCallback(err, stream, cb);
    }.bind(this));
};


FireTV.prototype.onStateChange = function (channel, state, val) {
    var self = this;
    switch(channel) {
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
        case usedStateNames.sendKeyCode.n:
            this.shell("input keyevent " + val);
            break;
        case usedStateNames.reboot.n:
            this.client.reboot(this.client.id, this.handleCallback.bind(this));
            break;
        case usedStateNames.screencap.n:
            this.client.screencap(this.client.id, this.handleCallback.bind(this));
            break;
        case usedStated.swapPower.n:
            this.shell("input keyevent " + adb.Keycode.KEYCODE_POWER);
            return true;
    }
};

// function start(app, activity) {
//     if (!activity) activity = 'MainActivity';
//     client.shell(client.d, 'am start -n ' + app + '/.' + activity, function(err, r) {
//     });
// }
//
//
// function startKodi() {
//     start('org.xbmc.kodi', 'Splash');
// }
// function stop(app) {
//     client.shell(d, 'am force-stop ' + app);
// }
// function stopKodi() {
//     client.shell(d, 'am force-stop org.xbmc.kodi');
// }
// function startNetflix() {
//     start ('com.netflix.ninja');
// }

function checkIP(cb) {
    if (adapter.config.devices.length) return cb && cb();
    var mdns = Mdns({
        timeout: 4,
        //returnOnFirstFound: true,
        name: '_amzn-wplay._tcp.local',
        find: 'amzn.dmgr:'
    });
    mdns.run (function(res) {
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
        }, cb );
    });
}

function existFile(fn) {
    try {
        var fs = require('fs');
        var stats = fs.lstatSync(fn);
        return stats.isFile();
    } catch(e) {
    }
    return false;
}

function normalizeConfig() {
    if (adapter.config.adbPath) {
        if (!existFile(adapter.config.adbPath) && !existFile(adapter.config.adbPath + '.exe')) {
            adapter.config.adbPath += '/adb';
            adapter.config.adbPath = adapter.config.adbPath.replace(/\\/g, '/');
            adapter.config.adbPath = adapter.config.adbPath.replace(/\/\//g, '/');
            if (!existFile(adapter.config.adbPath) && !existFile(adapter.config.adbPath + '.exe')) {
                adapter.log.error('adb executable not found. ' + adapter.config.adbPath);
            }
        }
    } else {
        adapter.config.adbPath = 'adb';
    }
    if (adapter.config.devices.unique('ip')) {
        changeAdapterConfig(adapter, function(config) {
            config.devices = adapter.config.devices;
        })
    };
 }
 
 
function startFire(cb) {
    var i = 0;
    function doIt() {
        if (i >= adapter.config.devices.length) return cb && cb();
        var device = adapter.config.devices[i++];
        if (device.enabled) {
            var firetv = new FireTV(device);
            firetv.create(doIt);
        }
    };
    doIt();
}


function main() {
    
    //adapter.config.adbPath = "C:\\Automation\\bin\\minimalADB\\adb";
    //adapter.config.adbPath = 'c:\\Automation\\bin\\adbLink\\adb';
    normalizeConfig();
    checkIP (
        startFire (function () {
           trackDevices();
        })
    );
    
    adapter.subscribeStates('*');
    adapter.subscribeObjects('*');
}

