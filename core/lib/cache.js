var cache = module.exports;

cache.get = function(objects, cb) {
    console.log('calling cb');
    cb(null, {});
};
