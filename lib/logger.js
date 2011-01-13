var sys    = require('sys'),
    logLevels = ['silent', 'error', 'warn', 'info', 'debug'],
    logger = module.exports,
    // Shell color escape codes
    escr ="",
    reset = escr+'[0m',
    // Color array matches logLevels array, starting from 'error'
    colors = [escr+'[31m', escr+'[33m', escr+'[34m'];

// ECMAScript getter and setter syntax
logger.__defineGetter__('logLevel', function(){
    return logLevels[this.selfLogLevel];
});

logger.__defineSetter__('logLevel', function(arg){
    this.selfLogLevel = logLevels.indexOf(arg);
    var em = function() {};
    
    // Create a funciton for each level except silent
    for(var x=1, l=logLevels.length; x<l; x++) {
        this[logLevels[x]] = this.selfLogLevel >= x ? function(y){return function() {
                sys.log.call(this, (this.color ? (colors[y-1] || '') + logLevels[y].toUpperCase() + reset :
                logLevels[y].toUpperCase())+': '+Array.prototype.slice.call(arguments).join(' '));
        };}(x) : em;
    }
});

// Default to colorful warn
logger.logLevel = 'warn';
logger.color = true;
