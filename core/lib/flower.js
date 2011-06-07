module.exports = flower;

function flower(context) {
    this.index = -1;
    this.functions = [];
    this.context = context || this;
    this.poopies = 0;
}

flower.prototype.add = function() {
    var me = this;
    this.poopies++;
    [].slice.call(arguments).forEach(function(func) {
        me.functions.push(function(err) {
            if(err) {
                me.error && me.error(err);
            } else {
                func.apply(this.context, [].slice.call(arguments, 1));
            }
        });
    });
    return this;
}

flower.prototype.onError = function(func) {
    this.error = func;
    return this;
};

flower.prototype.getNextFunction = function() {
    var me = this;
    return function() {
        me.next();
    }
};

flower.prototype.next = function() {
    this.index++;
    if(this.current = this.functions[this.index]) {
        this.current.apply(this, [].slice.call(arguments));
    }
};

flower.prototype.execute = function() {
    return this.next.apply(this, [null].concat(arguments));
};
