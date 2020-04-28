const child_process = require('child_process')
const cors = require('cors')
const express = require('express')
const fileUpload = require('express-fileupload')
const fs = require('fs')
const fsPromises = fs.promises
const sqlite = require('sqlite')
const sqlite3 = require('sqlite3')
	.verbose()
const util = require('util')

const exec = util.promisify(child_process.exec)

const port = process.env.PORT || 3000

const mergeResultLifetime = 10 * 60 * 1000 // 10min
const mapRenderLifetime = mergeResultLifetime

const getMapPathForHash = mapHash => `map_uploads/${mapHash.substr(0, 2)}/${mapHash}.sqlite`
const getRenderPathForHash = mapHash => `tmp/${mapHash}.png`
const getMergedMapPath = (hashes) => `tmp/merge_${hashes.join("_")}.sqlite`
const getMergedRenderPath = (hashes) => `tmp/merge_${hashes.join("_")}.png`

const getRenderOptions = ({
	bgColor = '#ffffff',
	drawAlpha = true,
	drawOrigin = false,
	drawScale = false,
}) => ({
	bgColor: String(bgColor),
	drawAlpha: !!drawAlpha,
	drawOrigin: !!drawOrigin,
	drawScale: !!drawScale,
})

const isHash = candidate => /^[0-9a-f]{32}$/.test(candidate)

function deleteAfterLifetime(path, lifetime, purpose) {
	setTimeout(() => {
		fs.unlink(path, err => err && console.log(
			`Failed to delete ${purpose} '${path}' after lifetime: ${err}`
		))
	}, lifetime)
}

async function doOnceAtATime(lock, key, body) {
	if (lock[key]) return await lock[key]
	const resultControl = {}
	lock[key] = new Promise((resolve, reject) => {
		resultControl.resolve = resolve
		resultControl.reject = reject
	})
	try {
		const result = await body()
		resultControl.resolve(result)
		return result
	} catch (err) {
		resultControl.reject(err)
		throw err
	} finally {
		delete lock[key]
	}
}

async function mergeIfNotExists(q) {
	if (fs.existsSync(q.mergedMapPath)) return
	try {
		await mergeMaps(q.mapPaths, q.mergedMapPath)
		console.log(`Merged maps to '${q.mergedMapPath}'`)
	} catch (err) {
		console.log(`Failed merging maps to '${q.mergedMapPath}': ${err}`)
		return err
	}
}

const mergeMapsLock = {}

const mergeMaps = (paths, mergedMapPath) => doOnceAtATime(mergeMapsLock, mergedMapPath, async () => {
	if (fs.existsSync(mergedMapPath)) return;

	let bottomPath = paths[0]

	try {
		await fsPromises.mkdir('tmp/', { recursive: true })
		await fsPromises.copyFile(bottomPath, mergedMapPath)
	} catch (err) {
		console.log(`Failed to copy '${bottomPath}' to '${mergedMapPath}': ${err}`)
		throw err
	}

	deleteAfterLifetime(mergedMapPath, mergeResultLifetime, `temporary merge result`)

	const mergeStatementForTop = (topPath) => `
		ATTACH '${topPath}' AS top;
		BEGIN;
		INSERT OR REPLACE INTO blocks SELECT * FROM top.blocks;
		COMMIT;
		DETACH top;`

	const db = await sqlite.open({
		filename: mergedMapPath,
		driver: sqlite3.Database
	})
	// skip first, which is bottomPath
	for (let i = 1; i < paths.length; i++) {
		await db.exec(mergeStatementForTop(paths[i]))
	}
	await db.close()
})

const renderMapLock = {}

const renderMapIfNotExists = (mapPath, imgPath, options = {}) => doOnceAtATime(renderMapLock, imgPath, async () => {
	if (fs.existsSync(imgPath)) return;

	// minetestmapper assumes a certain world directory structure, recreate it temporarily
	const tmpDir = imgPath + '_world'
	await fsPromises.mkdir(tmpDir, { recursive: true })
	await fsPromises.link(mapPath, `${tmpDir}/map.sqlite`)

	const { bgColor, drawAlpha, drawOrigin, drawScale } = options
	let command = `minetestmapper --backend sqlite3 -i "${tmpDir}" -o "${imgPath}" --bgcolor '${bgColor}'`
	if (drawAlpha) command += ' --drawalpha'
	if (drawOrigin) command += ' --draworigin'
	if (drawScale) command += ' --drawscale'
	console.log(command)
	try {
		// TODO render image with timeout
		const { stdout, stderr } = await exec(command)
		deleteAfterLifetime(imgPath, mapRenderLifetime, `temporary render`)
	} catch (err) {
		console.log(err.stdout)
		console.error(err.stderr)
		throw err
	} finally {
		fs.rmdirSync(tmpDir, { recursive: true })
	}
})

function logForReq(req, msg) {
	console.log(`[${req.ip}] ${msg}`)
}

const asyncMiddleware = fn => (req, res, next) => {
	Promise.resolve(fn(req, res, next))
		.catch(err => res.status(500).send({ error: "Internal server error" }))
		.catch(next)
}

async function getAndCheckMergeParams(req) {
	const hashes = String(req.query.hashes || "").split("_")
	if (!hashes || hashes.length < 2) {
		return { error: "Must supply at least two map file hashes." }
	}
	for (const hash of hashes) {
		if (!isHash(hash)) return { error: `Illegal map hash '${hash}'.` }
	}

	const mapPaths = hashes.map(getMapPathForHash)
	for (const mapPath of mapPaths) {
		if (!fs.existsSync(mapPath)) {
			logForReq(req, `Tried to access non-existant map '${mapPath}'`)
			return { error: "Unknown map." }
		}
	}
	const mergedMapPath = getMergedMapPath(hashes)
	const mergedRenderPath = getMergedRenderPath(hashes)
	return { hashes, mapPaths, mergedMapPath, mergedRenderPath }
}

const app = express()
app.use(cors())
app.use(fileUpload({
	abortOnLimit: true,
	useTempFiles: true,
	createParentPath: true,
	// busyboy args
	limits: {
		fileSize: 50 * 1024 * 1024, // 50MiB
		files: 1,
		fields: 0,
	},
	preservePath: true,
}))

app.get('/', (req, res) => res.send(`
<form
	action='/maps/upload.json'
	method='post'
	encType="multipart/form-data"
>
	<input type="file" name="map" />
	<input type='submit' value='Upload' />
</form>
`))

app.post('/maps/upload.json', asyncMiddleware(async function (req, res) {
	if (!req.files || !req.files.map) {
		return res.status(400).send({ error: "No map file in request." })
	}
	const mapFile = req.files.map
	const mapHash = mapFile.md5
	const fileData = { md5: mapHash, size: mapFile.size, name: mapFile.name }
	const mapPath = getMapPathForHash(mapHash)
	logForReq(req, `Uploading file ${JSON.stringify(fileData)} to '${mapPath}'`)
	try {
		await new Promise((resolve, reject) =>
			mapFile.mv(mapPath, err => { if (err) reject(err); else resolve() }))
		return res.send(JSON.stringify({ hash: mapHash, lifetime: -1 }))
	} catch (err) {
		logForReq(req, `Failed to move map file: ${err}`)
		return res.status(500).send({ error: "Upload failed." })
	}
}))

app.get('/maps/merged.json', asyncMiddleware(async (req, res) => {
	const q = await getAndCheckMergeParams(req)
	if (q.error) return res.status(400).send(q)

	const mergeError = await mergeIfNotExists(q)
	if (mergeError) return res.status(500).send({ error: "Failed to merge the maps, try again." })

	const stat = fs.statSync(q.mergedMapPath)
	res.send(JSON.stringify({
		size: stat.size,
		lifetime: mergeResultLifetime,
	}))
}))

app.get('/maps/merged.sqlite', asyncMiddleware(async (req, res) => {
	const q = await getAndCheckMergeParams(req)
	if (q.error) return res.status(400).send(q)

	const mergeError = await mergeIfNotExists(q)
	if (mergeError) return res.status(500).send({ error: "Failed to merge the maps, try again." })

	res.download(q.mergedMapPath, `merged.sqlite`)
}))

app.get('/maps/merged.png', asyncMiddleware(async (req, res) => {
	const q = await getAndCheckMergeParams(req)
	if (q.error) return res.status(400).send(q)

	const mergeError = await mergeIfNotExists(q)
	if (mergeError) return res.status(500).send({ error: "Failed to merge the maps, try again." })

	try {
		await renderMapIfNotExists(q.mergedMapPath, q.mergedRenderPath, getRenderOptions(req.query))
	} catch (err) {
		logForReq(req, `Failed to render the map '${q.mergedMapPath}': ${err}`)
		return res.status(500).send({ error: `Failed to render the map.` })
	}

	res.sendFile(await fsPromises.realpath(q.mergedRenderPath))
}))

app.get('/maps/:hash.png', asyncMiddleware(async (req, res) => {
	const mapHash = req.params.hash
	if (!isHash(mapHash)) return res.status(404).send({ error: `Illegal map hash '${mapHash}'.` })

	const mapPath = getMapPathForHash(mapHash)
	if (!fs.existsSync(mapPath)) return res.status(404).send({ error: `Map ${mapHash} not found.` })

	const imgPath = getRenderPathForHash(mapHash)
	try {
		await renderMapIfNotExists(mapPath, imgPath, getRenderOptions(req.query))
	} catch (err) {
		logForReq(req, `Failed to render the map '${mapPath}': ${err}`)
		return res.status(500).send({ error: `Failed to render the map.` })
	}

	res.sendFile(await fsPromises.realpath(imgPath))
}))

app.listen(port, () => console.log(`Listening at http://localhost:${port}`))
