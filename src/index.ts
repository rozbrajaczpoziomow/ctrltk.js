import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const config: Config = JSON.parse(readFileSync('config.json').toString());
const packageFile: { version: string; } = JSON.parse(readFileSync('package.json').toString());
const htmlDir = path.join(import.meta.dirname, '..', 'html');

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
interface Req extends express.Request {
	user: {
		username: string;
		permissions: Perms;
	}
};

const app = express();
app.disable('x-powered-by');

app.get('/', (req, res) => res.redirect(301, '/index.html'));
app.use('/', express.static(htmlDir));

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
		const user = split[0], pass = split.slice(1).join(':');
		if(!user || typeof pass !== 'string') {
			fail();
			return;
		}

		// `if` left in case we add more auth types
		if(config.auth.type === 'pass') {
			if(!(user in config.auth.users) || config.auth.users[user].password !== pass) {
				fail();
				return;
			}

			(req as Req).user = {
				username: user,
				permissions: config.auth.users[user].permissions
			}
		}

		next();
	} catch(e) {
		console.error('Error in authentication middleware:');
		console.error(e);
		fail();
	}
});

app.use('/api', express.json());

app.get('/api/info', (req, res) => {
	const user = (req as Req).user;
	res.json({
		version: `ctrltk.js/${packageFile.version}`,
		user
	});
});

app.listen(config.port, () => {
	console.log(`Listening on http://127.0.0.1:${config.port}`);
});