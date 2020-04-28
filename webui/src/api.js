const fileKey = (file) => `${file.name}\n${file.size}\n${file.lastModified}`

// options: bgColor drawAlpha drawOrigin drawScale
const stringifyRenderOptions = (options) =>
  Object.entries(options || {}).map(([k, v]) => `${k}=${v}`).join("&")

export default apiRootUrl => {
  const mapRenderUrl = (hash, options) =>
    `${apiRootUrl}/${hash}.png?${stringifyRenderOptions(options)}`

  const mergeRenderUrl = (hashes, options) =>
    `${apiRootUrl}/merged.png?hashes=${hashes.join("_")}&${stringifyRenderOptions(options)}`

  const mergeMapUrl = (hashes) =>
    `${apiRootUrl}/merged.sqlite?hashes=${hashes.join("_")}`

  let uploadPromises = {}
  const uploadSqlite = (file) => doOnceThenPromise(uploadPromises, fileKey(file), async () => {
    const formData = new FormData()
    formData.append('map', file)

    const response = await fetch(`${apiRootUrl}/upload.json`, {
      method: 'POST',
      body: formData,
    })
    return response.json()
  })

  return {
    fileKey, mapRenderUrl, mergeMapUrl, mergeRenderUrl, uploadSqlite,
  }
}

async function doOnceThenPromise(lock, key, body) {
  if (lock[key]) return await lock[key]
  const resultControl = {}
  lock[key] = new Promise((resolve, reject) => {
    resultControl.resolve = resolve
    resultControl.reject = reject
  })
  try {
    resultControl.resolve(await body())
  } catch (err) {
    resultControl.reject(err)
  }
  return await lock[key]
}
