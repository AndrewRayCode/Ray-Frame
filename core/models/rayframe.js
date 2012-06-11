(function() {

var server, _, Backbone, Frayme;

// Determine if we are in nodejs
if (typeof exports !== 'undefined') {
    _ = require('underscore')._;
    Backbone = require('backbone');
    server = true;
}

Frayme = Frayme || _.extend({}, Backbone.Events);

// Helper function to register a new model and make it fraymey
Frayme.addModel = function(name, model) {
    var init = model.initialize || function() {},
        wrapped;

    // Whenver a new one of these is made, trigger a created event
    model.initialize = function() {
        this.serialName = name;
        init.apply(this, arguments);
        Frayme.trigger('newModel:' + name, this);
    };
    wrapped = this.BaseModel.extend(model);

    // Store the serial name for saving to the database
    wrapped.serialName = name;

    this[name] = wrapped;
    this.trigger('addModel', name, wrapped);
};

// Obsolete?
Frayme.addCollection = function(name, model) {
    Frayme[name] = Frayme.BaseCollection.extend(model);
    Frayme[name].serialName = name;
};

// All models extend this. Provides database interaction stuff
Frayme.BaseModel = Backbone.Model.extend({
    defaults: {
        editor: 'text',
        modified: new Date()
    },

    subModels: {},

    save: function() {
        this.set('modified', new Date());
        this.trigger('fraymeSave');
    },

    editField: function(field, widget) {
        this.editFields[field] = widget;
    },

    getEditField: function(field) {
        return this.editFields[field] || this.defaults.editor;
    },

    set: function(attributes, options) {
        for(var key in attributes) {
            if(attributes[key].toFullJSON){
                this.subModels[key] = true;
            }
        }
        Backbone.Model.prototype.set.call(this, attributes, options);
        return this;
    }

    //getFull: function() {
        //return Backbone.Model.prototype.get.call(this, attribute);
    //}
});

// Obsolete? May use collections later down the line
Frayme.BaseCollection = Backbone.Collection.extend({
    toFullJSON: function() {
        return this.map(function(item) {
            return item.toFullJSON ? item.toFullJSON() : item;
        });
    }
});

Frayme.addModel('Reference', {
    initialize: function() {
        this.models = _.toArray(arguments);
    },
    references: function() {
        return this.models.map(function(model) {
            return model.serialName;
        });
    },
    serialize: function() {
        return this.references().join('-');
    },
    toFullJSON: function() {
        return {
            model: this.serialize,
            models: this.models
        };
    }
});

Frayme.addModel('Page', {
    initialize: function() {
        this.defaults.template = this.serialName.toLowerCase() + '.html';
    },

    validate: function(attrs) {
        if(!attrs.title || !attrs.title.trim || !attrs.title.trim()) {
            return 'A title is required';
        }
        this.set('modified', new Date());
    },

    url: function() {
        return this.get('title').replace(/\s+/g, '_').replace(/\W/g, '').trim().toLowerCase();
    },

    toFullJSON: function() {
        var json = this.toJSON(),
            value,
            field;

        for(field in this.subModels) {
            value = json[field];
            if(value && value.toFullJSON) {
                json[field] = value.toFullJSON();
            }
        }
        return _.extend(json, {
            url: this.url(),
            model: this.serialName,
            parent: this.parent && this.parent.get ? this.parent.get('_id') : this.parent
        });
    }
});

module.exports = Frayme;

}());
