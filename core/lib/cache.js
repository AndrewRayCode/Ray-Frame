var cache = module.exports,
    log = require('simple-logger');

cache.get = function(objects, cb) {
    if(!objects.length) {
        return cb();
    }
    var count = objects.length,
        processed = 0,
        output = {},
        toGetByKey = [];

    function ifFinished() {
        if(processed == count) {
            cb(null, output);
        }
    }

    var item;
    for(var x = 0, l = count; x < l; x++) {
        item = objects[x];
        if(item.id) {
            toGetByKey.push(item.id);
        }
    }
    if(toGetByKey.length) {
        this.couch.getDocsByKey(toGetByKey, function(err, result) {
            log.error(result);
            var rows = result.rows;
            processed += result.rows.length;

            for(var x = 0, l = rows.length; x < l; x++) {
                output[rows[x].key] = rows[x];;
            };
            ifFinished();
        });
    }
};
