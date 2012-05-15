var cradle = require('cradle'),
    q = require('q'),
    Frayme = require('../models/rayframe');

module.exports = {
    connect: function(db) {
        this.couch = new(cradle.Connection)().database(db);

        for(var fn in this.couch) {
            if(this.couch[fn] instanceof Function) {
                this[fn] = q.nbind(this.couch[fn], this.couch);
            }
        }

        var _save = this.save;

        this.save = function() {
            // save('id', {document})
            if(arguments.length === 2) {
                return _save(arguments[0], arguments[1]);
            }

            // save([array of documents])
            if(arguments[0] instanceof Array) {
                var jsons = [];
                arguments[0].forEach(function(doc) {
                    jsons.push(doc.toFullJSON ? doc.toFullJSON() : doc);
                });
                return _save(jsons);
            }

            // save({document})
            return _save(arguments[0], arguments[1].toFullJSON());
        };
    },

    serialize: function(doc) {
        if(doc.toFullJSON) {
            return doc.save().toFullJSON();
        }
        return doc;
    },

    toModel: function(docOrDocs) {
        var me = this;
        if(!docOrDocs.length) {
            return this.cast(docOrDocs);
        }
        return docOrDocs.map(this.cast);
    },

    cast: function(doc) {
        return new Frayme[doc.model](doc);
    }
};
