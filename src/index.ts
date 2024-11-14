import express from 'express';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';


// Constants
const config: Config = JSON.parse(readFileSync('config.json').toString());
const packageFile: { name: string; version: string; } = JSON.parse(readFileSync('package.json').toString());
const htmlDir = path.join(import.meta.dirname, '..', 'html');

function exec(command: string, args: string[]): string | undefined {
	try {
		const proc = spawnSync(command, args, { encoding: 'utf-8' });
		const ret = proc.stdout.trim();
		if(process.env.DEBUG)
			console.log(`$ ${command} ${args} => '${ret}'`);
		return ret;
	} catch(e) {
		console.error(`Calling ${command} ${args} failed:`);
		console.error(e);
	}
}

// Unfortunately there is no good solution to this (x11 package has no TS bindings and the xdotool package doesn't compile)
function xdotool(args: string[]): string | undefined {
	return exec('xdotool', args);
}

function checkAuth(user: User, check: Perms): boolean {
	const level = user.permissions;
	// read - every user account has at minimum read permissions
	// write - write || admin
	// admin - admin
	return check === 'read' || check === level || (check === 'write' && level === 'admin');
}

// Package dependencies
for(const command of ['xdotool', 'scrot', 'file'])
	if(!exec(command, ['--help'])) {
		console.error(`Shell command not found: "${command}"; please install a package that provides ${command}`);
		process.exit(1);
	}

// Typedef
type Perms = 'read' | 'write' | 'admin';
type Config = {
	port: number;
	auth: {
		type: 'pass';
		users: {
			[username: string]: {
				password: string; // TODO: hash
				permissions: Perms;
			}
		}
	}
};
type User = {
	username: string;
	permissions: Perms;
};
interface Req extends express.Request {
	user: User;
};

const app = express();
app.disable('x-powered-by');

// Static pages
app.get('/', (req, res) => res.redirect(301, '/index.html'));
app.use('/', express.static(htmlDir));

// Authentication middleware
app.use('/api', (req, res, next) => {
	const fail = () => res.status(401).header('WWW-Authenticate', 'Basic realm="ctrltk.js"').sendFile(`${htmlDir}/401.html`);
	try {
		const header = req.header('authorization');
		if(!header) {
			fail();
			return;
		}

		const [type, value] = header.split(' ');
		if(type !== 'Basic' || typeof value !== 'string') {
			fail();
			return;
		}

		const split = Buffer.from(value, 'base64').toString().split(':');
		const username = split[0], pass = split.slice(1).join(':');
		if(!username || typeof pass !== 'string') {
			fail();
			return;
		}

		let user: User | undefined = undefined;

		// `if` left in case we add more auth types
		if(config.auth.type === 'pass') {
			if(!(username in config.auth.users) || config.auth.users[username].password !== pass) {
				console.log(`${username} - incorrect password (${req.method} ${req.originalUrl})`);
				fail();
				return;
			}

			user = {
				username: username,
				permissions: config.auth.users[username].permissions
			}
		}

		if(!user)
			throw new Error('User not found/authenticated and fail() not called.');

		// GET - anyone authenticated can do
		// POST - requires write
		// TODO: POST to /api/admin requires admin (when /api/admin is implemented)

		if(req.method === 'POST' && !checkAuth(user, 'write')) {
			console.log(`${username} - tried to access resources they couldn't (${req.method} ${req.originalUrl} with ${user.permissions})`)
			fail();
			return;
		}

		console.log(`${username} - ${req.method} ${req.originalUrl} [${user.permissions}]`);
		(req as Req).user = user;
		next();
	} catch(e) {
		console.error('Error in authentication middleware:');
		console.error(e);
		fail();
	}
});

app.use('/api', express.json());

if(process.env.DEBUGGER)
	app.use('/api', (req, res, next) => {
		console.log(req.body);
		next();
	})

// GET
app.get('/api/info', (req, res) => {
	const user = (req as Req).user;
	res.json({
		version: `${packageFile.name}/${packageFile.version}`,
		user
	});
});

app.get('/api/mouse', (req, res) => {
	const out = xdotool(['getmouselocation']);
	if(!out) {
		res.status(500).json({});
		return;
	}
	const [x, y, screen, _window] = out.split(' ').map(s => +s.slice(s.indexOf(':') + 1));
	res.json({ x, y });
});

app.get('/api/image', (req, res) => {
	try {
		// tried to make scrot output to stdout but just says
		// scrot: failed to save image: /dev/stdout: No such device or address
		// so unfortunately, we gotta touch disk/ramdisk

		// jpg gives much worse (lossy) quality, but is much smaller
		let format = req.query.format;
		if(format !== 'png' && format !== 'jpg')
			format = 'png';

		const path = `/tmp/ctrltk.js-scrot.${format}`;
		exec('scrot', ['-zpoZ', '9', '-F', path]);
		const resolution = exec('file', [path])?.replaceAll(' ', '').match(/,\d+x\d+,/)?.[0].slice(1, -1) ?? '';
		res.header('Cache-Control', 'max-age=0, must-revalidate');
		// header isn't the best solution but it's the best/easiest way to pass it with file upload
		res.header('X-Screen-Resolution', resolution);
		res.sendFile(path);
	} catch(e) {
		console.error('Taking a screenshot failed:');
		console.error(e);
		res.status(500).send();
	}
});

// Helper route to authenticate
app.get('/api/auth', (req, res) => {
	res.redirect('/index.html');
});

// POST
app.post('/api/keyboard', (req, res) => {
	type req = {
		key: string;
		modifiers: {
			ctrl: boolean;
			alt: boolean;
			super: boolean;
		};
	};
	// Boring field validation
	const { key, modifiers } = req.body as req;
	if(typeof key !== 'string' || typeof modifiers !== 'object') {
		res.status(400).send();
		return;
	}

	const { ctrl, alt, super: _super } = modifiers;
	if(typeof ctrl !== 'boolean' || typeof _super !== 'boolean' || typeof alt !== 'boolean') {
		res.status(400).send();
		return;
	}

	xdotool(['key', `${ctrl? 'ctrl+' : ''}${alt? 'alt+' : ''}${_super? 'super+' : ''}${key}`]);
	res.status(200).send();
});

app.post('/api/mouse/move', (req, res) => {
	type req = {
		x: number;
		y: number;
		type: 'relative' | 'absolute';
	};
	const { x, y, type } = req.body as req;
	if(typeof x !== 'number' || typeof y !== 'number' || (type !== 'relative' && type !== 'absolute')) {
		res.status(400).send();
		return;
	}

	xdotool([`mousemove${type === 'relative'? '_relative' : ''}`, `${x}`, `${y}`]);
	res.status(200).send();
});

app.post('/api/mouse/scroll', (req, res) => {
	type req = {
		direction: 'up' | 'down';
	};
	const { direction } = req.body as req;
	if(direction !== 'up' && direction !== 'down') {
		res.status(400).send();
		return;
	}

	xdotool(['click', direction === 'up'? '4' : '5'])
	res.status(200).send();
});

app.post('/api/mouse/click', (req, res) => {
	type req = {
		button: 'left' | 'middle' | 'right';
	};
	const json: req = req.body;
	const { button } = json;
	if(button !== 'left' && button !== 'middle' && button !== 'right') {
		res.status(400).send();
		return;
	}

	xdotool(['click', button === 'left'? '1' : button === 'middle'? '2' : '3']);
	res.status(200).send();
});

app.listen(config.port, () => {
	console.log(`Listening on http://127.0.0.1:${config.port}`);
});