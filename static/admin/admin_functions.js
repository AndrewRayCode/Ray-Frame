var hover = hover = new Element('a').addClass('edit_btn'),
	cancel = new Element('a').addClass('cancel_btn').addEvent('click', cancelClick),
	send = new Element('a').addClass('send_btn').addEvent('click', sendClick),
	currentEditor = {};
	
window.addEvent('domready', function() {
	var pos;
	$$('.edit_me').each(function(item) {
		item.setStyle('border', '2px solid red');
		pos = item.getPosition();
		hover.clone().setStyles({top:pos.y, left:pos.x}).inject(document.body).match = item;
	});

	document.body.addEvent('click', bodyClickHandler);
});

function bodyClickHandler(evt) {
	if(evt.target.hasClass('edit_btn')) {
		editClick(evt.target);
	}
}

function editClick(elem) {
	currentEditor.edit = elem.setStyles({display: 'none'});
	currentEditor.target = elem.match.setStyles({display:'none'});
	var pos = elem.match.getPosition();

	currentEditor.cancel = cancel.setStyles({display:'block', top:pos.y, left:pos.x}).inject(document.body);
	currentEditor.send = send.setStyles({display:'block', top:pos.y, left:pos.x + 15}).inject(document.body);

	elem.match.setStyles({display:'none'});
	buildEditor(elem.match.get('id'));
}

function buildEditor(id) {
	currentEditor.input = new Element('input').set({type: 'text', value:$(id).get('html')}).inject($(id), 'after');
}

function sendClick(evt) {
	new Request.JSON({
		url: '/update',
		data: {field:currentEditor.target.get('id'), value:currentEditor.input.get('value')},
		onSuccess: function(data) {
			if(data.status == 'success') {
				currentEditor.target.set('html', data.new_value);
				closeEdit(evt.target.match);
			} else {
				alert(data.status+': '+data.message);
			}
		}
	}).send();
}

function cancelClick() {
	closeEdit();
}

function closeEdit(item) {
	currentEditor.cancel.setStyle('display', 'none');
	currentEditor.send.setStyle('display', 'none');
	currentEditor.input.destroy();
	currentEditor.target.setStyles({display: 'block'});
	currentEditor.edit.setStyles({display: 'block'});
}
