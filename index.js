const Levels = [
  'trace', 'verbose', 'silly',
  'debug',
  'info', 'notice',
  'success',
  'http',
  'timing',
  'redirect',
  'warn', 'warning',
  'error',
  'crit', 'critical', 'fatal',
  'alert',
  'emerg', 'emergency',
];

class Loggy {
  constructor(app, remote = 'http://127.0.0.1:1065/', defaults = {}) {
    this.app = app;
    this.remote = remote;
    this.defaults = defaults;
    this.timers = new Map();
    this.buffer = [];
    this.timeout = null;

    this.exitOnFatal = true;
    this.printToConsole = true;
    this.throttleInterval = 100;
    this.throttleLimit = 1000; // Max number of items per buffer
  }

  // Supported calls:
  // .log('Message'[, { other fields }])
  // .log('Message', 3.14) // message + value shorthand
  // .log(error[, { other fields }])
  // .log({ all fields })
  // .log([{ errors }][, { other fields}]) // array of events
  log(message, fields, immediate) {
    if (message instanceof Error) {
      this.log(Object.assign({
        level: 'error',
        code: message.name,
        message: message.message,
        details: message.stack,
      }, fields || {}));
      return;
    }
    if (Array.isArray(message)) {
      for (const event of message) {
        this.log(event, fields, immediate);
      }
      return;
    }

    if (typeof fields === 'boolean' && immediate === undefined) {
      immediate = fields;
      if (typeof message === 'object') {
        fields = message;
      }
    }
    const ts = (new Date()).toISOString();
    const event = Object.assign(
      {},
      this.defaults,
      { ts },
      typeof fields === 'object' ? fields : (typeof fields === 'number' ? { value: fields } : {}),
      typeof message === 'object' ? message : { message }
    );
    const willExit = this.exitOnFatal && ['fatal', 'emerg', 'emergency'].includes(event.level);

    if (this.throttleInterval <= 0) {
      this.send(event);
    } else { // Add to buffer and wait
      this.buffer.push(event);
      if (willExit || immediate || this.buffer.length >= this.throttleLimit) {
        this.sendBuffered();
      } else
      if (!this.timeout) {
        this.timeout = setTimeout(this.sendBuffered.bind(this), this.throttleInterval);
      }
    }

    if (this.printToConsole) {
      console.log(event); // TODO: proper formatting
    }

    if (willExit) {
      process.exit(1);
    }
  }
  send(data) {
    fetch(`${this.remote}${this.remote.endsWith('/') ? '' : '/'}log/${this.app}`, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }
  sendBuffered() {
    clearTimeout(this.timeout);
    this.send(this.buffer);
    this.buffer = [];
    this.timeout = null;
  }

  time(label = 'default', fields = {}) {
    this.timers.set(label, { st: Date.now(), fields });
  }
  timeLog(label = 'default', fields = {}) {
    const timer = this.timers.get(label);
    if (!timer) {
      this.warn(`Timer '${label}' does not exist`);
      return;
    }
    this.log(label, Object.assign({
      level: 'timing',
      value: (Date.now() - timer.st) / 1000.0, // In seconds
    }, timer.fields, fields));
  }
  timeEnd(label = 'default', fields = {}) {
    this.timeLog(label, fields);
    this.timers.delete(label);
  }

  // Attaches event handlers to process
  handleGlobalEvents({ exceptions = true, rejections = true, warnings = true, exits = true } = {}) {
    // TODO: do the same with window (in browser environment)
    exceptions && process.on('uncaughtException', (err, origin) => {
      // Will cause application to exit (unless exitOnFatal is set to false)
      this.log(err, Object.assign({ level: 'fatal' }, exceptions === true ? {} : exceptions), true);
    });
    rejections && process.on('unhandledRejection', (reason, p) => {
      this.log(reason, Object.assign({ level: 'error' }, rejections === true ? {} : rejections), true);
    });
    warnings && process.on('warning', (err) => {
      this.log(err, Object.assign({ level: 'warn' }, warnings === true ? {} : warnings));
    });
    exits && process.on('exit', (code) => {
      this.log(`Application stops with exit code ${code}`, Object.assign({ level: 'info', code }, exits === true ? {} : exits), true);
    });
  }
}

for (const field of ['user', 'module']) {
  Loggy.prototype[field] = function(value) {
    return new Loggy(this.app, this.remote, Object.assign({}, this.defaults, {
      [field]: value,
    }));
  }
}
for (const level of Levels) {
  Loggy.prototype[level] = function(message, fields = {}, immediate = undefined) {
    this.log(message, Object.assign({ level }, fields, immediate));
  }
}

// TODO: transports for Winston/Pino/Bunyan/Signale/Morgan
// TODO: middleware for Express

module.exports = Loggy;