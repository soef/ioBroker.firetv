"use strict";

var soef = require('soef'),
    adb = require('adbkit'),
    path = require('path'),
    Client = require('./node_modules/adbkit/lib/adb/client'),
    Mdns = require('mdns-discovery');

soef.extendAll();

//Client.prototype.parent = { shell: Client.prototype.shell };
Client.prototype.shellEx = function(id, command, cb) {
    //this.parent.shell.call( this, id, command, function (err, stream) {
    this.shell(id, command, function (err, stream) {
        if (err || !stream) return cb & cb(err, 0);
        adb.util.readAll(stream, function (err, output) {
            if (err || !stream) return cb && cb(err);
            var ar = output.toString().split('\r\n');
            ar.length--;
            cb && cb(0, ar);
        });
    })
};

Client.prototype.shell1 = function (id, command, cb) {
    return this.shellEx(id, command, function (err, ar) {
        cb && cb(err, (ar && ar.length) ? ar[0] : '');
    });
};

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
    kodi: 'org.xbmc.kodi/.Splash',
    netflix: 'com.netflix.ninja'
};

var adapter = soef.Adapter (
    main,
    onStateChange,
    onUnload,
    onMessage,
    // {
    //     name: 'firetv'
    // }
    'firetv'
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
    on:          { n: 'on',          val: false, common: { min: false, max: true}},
    
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


function closeAllFireTVs() {
    Object.keys(fireTVs).forEach(function(v) {
        fireTVs[v].close();
        delete fireTVs[v];
    });
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
        var ar = device.id.split(':');
        var ftv = fireTVs[normalizedName(ar[0])];
        if (ftv) ftv.setOnline(val);
    }
    new_g_client();
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
    adapter.log.debug("FireTV: " + entry.ip);
    var d = this.dev.getFullId('');
    fireTVs [d] = this;
};


FireTV.prototype.startClient = function(cb) {
    var self = this;
    this.client = adb.createClient({ bin: adapter.config.adbPath });
    this.client.connect(this.id, 5555, function(err,id) {
        if (err || !id) {
            adapter.log.error('can not connect to ' + self.id + ' Error=' + err.message)
            return;
        } else {
            adapter.log.debug('Connected to ' + self.id + ' id=' + id);
        }
    
        // self.client.getProperties(self.id, function(err, properties) {
        // });
        
        self.client.id = id;
        self.client.version(function(err, version) {
            self.getAndroidVersion(function(androidVersion) {
                self.getAPILevel(function (apiLevel) {
                    //adapter.log.info(self.id + ": ADB version: " + version + ', Android Version: ' + androidVersion + ', API Level: ' + apiLevel);
                    soef.log("%s: ADB version: %s, Android Version: %s, API Level: %s", self.id, version, androidVersion, apiLevel);
                });
            });
        });
        self.getPowerState(function(on) {
            self.dev.setImmediately(usedStateNames.on.n, on);
        });
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
     if (this.client) {
         this.client.disconnect(this.client.id);
         this.client = undefined;
     }
};


FireTV.prototype.shell1 /*Line*/ = function (cmd, cb) {
    this.shell (cmd, function(ar) {
        if (ar && ar.length) return cb && cb(ar[0]);
        cb && cb('');
    })
};

FireTV.prototype.getAndroidVersion = function (cb) {
    return this.shell1('getprop ro.build.version.release', cb);
};

FireTV.prototype.getAPILevel = function (cb) {
    return this.shell1('getprop ro.build.version.sdk', cb);
};

FireTV.prototype.setOnline = function (online) {
    this.dev.setImmediately(usedStateNames.online.n, online ? true : false);
};


FireTV.prototype.handleCallback = function (err, stream, cb) {
    if (err || !stream) {
        adapter.log.error('ID: ' + this.id + ' Error=' + err.message)
        if (err && err.message) this.dev.setImmediately(err.message);
        return cb && cb();
    }
    var self = this;
    adb.util.readAll(stream, function(err, output) {
        if (!err && output) {
            var ar = output.toString().split('\r\n');
            ar.length--;
            if (ar.length < 10) ar.forEach(function (line) {
                adapter.log.debug(line);
                self.dev.setImmediately('result', line);
            });
        }
        if (cb) cb (ar);
    });
};

FireTV.prototype.shell = function (command, cb) {
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

FireTV.prototype.getPowerState = function (cb) {
    this.shell('dumpsys power', function (ar) {
    //this.shell('dumpsys input_method', function (ar) {
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
        case usedStateNames.swapPower.n:
            this.shell("input keyevent " + adb.Keycode.KEYCODE_POWER);
            return true;
        case 'power':
        case usedStateNames.on.n:
            this.getPowerState(function(on) {
                if (val != on) this.shell("input keyevent " + adb.Keycode.KEYCODE_POWER);
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

var fs;
function existFile(fn) {
    try {
        fs = fs || require('fs');
        var stats = fs.lstatSync(fn);
        return stats.isFile();
    } catch(e) {
    }
    return false;
}

function checkPATH() {
    var fn, ar = process.env.PATH.split(path.delimiter);
    var exe = isWin ? 'adb.exe' : 'adb';
    ar.find(function(v) {
        if (v.toLowerCase().indexOf('adb') >= 0) {
            var _fn = path.join(v, exe);
            if (existFile(_fn)) {
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
    if (!existFile(adapter.config.adbPath)) {
        if (isWin && adapter.config.adbPath && existFile(adapter.config.adbPath + '.exe')) {
            adapter.config.adbPath += '.exe';
        } else {
            var p = adapter.config.adbPath + '/adb';
            p = p.replace(/\\/g, '/').replace(/\/\//g, '/');
            if (!isWin && existFile(p)) {
                adapter.config.adbPath = p;
            } else if (isWin && existFile(p + '.exe')) {
                adapter.config.adbPath = p + '.exe';
            } else if (isWin && existFile(defaultMinimalABAndFastboot)) {
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
    //var client = adb.createClient({bin: adapter.config.adbPath});
    //var client = new Client({bin: adapter.config.adbPath});
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
    
    checkIP (function () {
        startFireTVs (function () {
            trackDevices();
        })
    });
    
    adapter.subscribeStates('*');
    //adapter.subscribeObjects('*');
}

