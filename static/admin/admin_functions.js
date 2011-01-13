window.addEvent('domready', function() {
	$$('.edit_me').addEvents({
		mouseenter: function() {
			this.orig_bg = this.getStyle('background-color');
			this.setStyle('background-color', 'green');
		}, mouseleave: function() {
			this.setStyle('background-color', this.orig_bg);
		}
	});
});
