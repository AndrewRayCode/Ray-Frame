window.addEvent('domready', function() {
	var hover = new Element('div').addClass('edit_btn'), pos;

	$$('.edit_me').each(function(item) {
		pos = item.getPosition();
		hover.clone().inject(document.body).setStyles({top:pos.y, left:pos.x});
	});
});
