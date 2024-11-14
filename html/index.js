const img = document.getElementById('img');
const controls = document.getElementById('controls');
const info = document.getElementById('info');
const ctrlButton = document.getElementById('ctrlButton');
const altButton = document.getElementById('altButton');
const superButton = document.getElementById('superButton');
const move = document.getElementById('move');

function button(btn) {
	if(btn.classList.contains('active'))
		btn.classList.remove('active');
	else
		btn.classList.add('active');
}

function post(endpoint, data) {
	return fetch(`api/${endpoint}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(data),
		credentials: 'include'
	});
}

let imageWidth, imageHeight;

async function reloadImage() {
	const image = await fetch(`api/image?format=jpg&${Date.now()}`);
	[imageWidth, imageHeight] = image.headers.get('X-Screen-Resolution').split('x');
	img.src = URL.createObjectURL(await image.blob());
	// img.onload = () => setTimeout(reloadImage, 10);
	img.onload = reloadImage;
}

function resize() {
	img.style.width = controls.style.width = `${window.innerWidth - 50}px`;
}
window.addEventListener('resize', resize);
resize();

async function main() {
	const req = await fetch('api/info');
	if(req.status == 401)
		document.location = 'api/auth';
	const json = await req.json();
	info.innerText = `${json.version} - ${json.user.username} (${json.user.permissions}) (click for controls & such)`
	reloadImage();

	if(json.user.permissions == 'read') {
		controls.remove();
		return;
	}

	window.addEventListener('keydown', ev => {
		ev.preventDefault();
		let key = ev.key;
		if(key == 'Control' || key == 'Alt' || key == 'Shift')
			return;
		if(key == 'Enter')
			key = 'Return';
		post('keyboard', {
			key,
			modifiers: {
				ctrl: ev.ctrlKey || ctrlButton.classList.contains('active'),
				alt: ev.altKey || altButton.classList.contains('active'),
				super: ev.metaKey || superButton.classList.contains('active')
			}
		});
	});

	window.addEventListener('mousedown', ev => {
		ev.preventDefault();
		post('mouse/click', {
			button: ev.button == 0? 'left' : ev.button == 1? 'middle' : 'right'
		});
	});

	window.addEventListener('wheel', ev => {
		ev.preventDefault();
		post('mouse/scroll', {
			direction: ev.deltaY < 0? 'up' : 'down'
		});
	});

	let disableMove = false;
	window.addEventListener('dblclick', ev => {
		ev.preventDefault();
		disableMove = !disableMove;
		move.style.display = disableMove? '' : 'none';
	});

	window.addEventListener('mousemove', ev => {
		if(disableMove)
			return;
		const pageImageHeight = (window.innerWidth - 20) * (imageHeight / imageWidth)
		// console.log((window.innerWidth - 50), imageWidth, ev.clientX, ev.clientX * (imageWidth / (window.innerWidth - 50)));
		// console.log((window.innerHeight - 50), imageHeight, ev.clientX, ev.clientX * (imageHeight / (window.innerHeight - 50)));
		post('mouse/move', {
			x: ev.clientX * (imageWidth / (window.innerWidth - 50)),
			y: ev.clientY * (pageImageHeight / (window.innerHeight - 50)),
			type: 'absolute'
		});
	});
}

main();