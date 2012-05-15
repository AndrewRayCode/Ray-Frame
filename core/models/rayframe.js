(function() {

var server, _, Backbone,
    Frayme = this.Frayme = this.Frayme || {};

if (typeof exports !== 'undefined') {
    module.exports = this.Frayme;
    _ = require('underscore')._;
    Backbone = require('backbone');
    server = true;
}
    
Frayme.BaseModel = Backbone.Model.extend({
    model: 'BaseModel',
    
    defaults: {
        editor: 'text',
        modified: new Date()
    },

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

    //get: function(attribute) {
        //var field = Backbone.Model.prototype.get.call(this, attribute);
        //return (field && field.value) ? field.value : field;
    //},

    //getFull: function() {
        //return Backbone.Model.prototype.get.call(this, attribute);
    //}
});

Frayme.Page = Frayme.BaseModel.extend({
    model: 'Page',

    initialize: function() {
        this.defaults.template = this.model + '.html';
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
        return _.extend(this.toJSON(), {
            url: this.url(),
            model: this.model,
            parent: this.parent && this.parent.get ? this.parent.get('_id') : this.parent
        });
    }
});

Frayme.PageList = Backbone.Collection.extend({
    model: Frayme.Page
});

Frayme.PageReferenceList = Frayme.BaseModel.extend({
    model: 'PageReferenceList',
    ids: []
});

}());
