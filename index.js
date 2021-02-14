const LRUCache = require('lru-cache')
const httpProxy = require('http-proxy')
const { send, json, sendError } = require('micro')
//const config = require('./config.json')
const qs = require('qs')
const route = require('micro-route')

const maxAge = process.env.CACHE_EXPIRATION_IN_MINUTES ?
  parseInt(process.env.CACHE_EXPIRATION_IN_MINUTES) * 1000 * 60 :
  1000 * 60; // cache for 1 minute
const cache = new LRUCache({ maxAge: maxAge })
const allowedContentTypes = ['webchatFeature', 'insightsTips'];
const healthcheckRoute = route('/healthcheck', ['GET'])

function createProxyFn(config) {
  const proxy = createContentfulProxy(config)

  return (req, res) => {
    if(healthcheckRoute(req)){
      send(res, 200, "OK")
      return
    }
    if (req.method === 'DELETE') {
      clearCache()
      send(res, 200)
      return
    }
    
    const match = req.url.match(/^\/entries\/?\?/);
    if(!match){
      send(res, 401, "Only '/entries' allowed");
      return;
    }
    const [,queryString] = req.url.split('?');
    const qsParsed = qs.parse(queryString);
    if(!qsParsed.hasOwnProperty('content_type') || !allowedContentTypes.includes(qsParsed.content_type)){
      send(res, 401, "Missing content_type or content_type value not allowed");
      return;
    }
    
    if (cache.has(req.url)) {
      const cached = cache.get(req.url)
      addHeaders(res, cached.headers)
      res.setHeader('X-Hit-From-Cache', "1")
      send(res, 200, cached.data)
      return
    }

    proxy.web(req, res)
  }
}

function addHeaders(res, headers) {
  for (let header in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, header)) {
      res.setHeader(header, headers[header])
    }
  }
}

function clearCache() {
  cache.reset()
}

function createContentfulProxy(config) {
  const prependPath = config.hasOwnProperty('spaceId')
  const target = getContentfulUrl(config)
  const token = getAuthToken(config)
  const secure = Boolean(config.secure)

  const options = {
    target,
    changeOrigin: true,
    xfwd: true,
    secure,
    prependPath: true,
    preserveHeaderKeyCase: true,
    headers: { Authorization: `Bearer ${token}` }
  }

  return httpProxy.createProxyServer(options)
    .on('proxyRes', cacheResponse)
    .on('error', handleError)
}

async function cacheResponse(proxyRes, { url: key }) {
  const { status, statusText, headers } = proxyRes
  const data = await json(proxyRes)
  cache.set(key, { status, statusText, headers, data })
}

function getAuthToken({ accessToken, previewToken, preview = false }) {
  const hasPreviewToken = Boolean(previewToken)
  if (!hasPreviewToken && preview) {
    const errorMsg = 'Please provide preview API token to use the preview API.'
    throw new Error(errorMsg)
    process.exit(1)
  }
  return preview ? previewToken : accessToken
}

function getContentfulUrl({ preview = false, secure = true, spaceId = '' }) {
  const path = spaceId ? `spaces/${spaceId}` : ''
  const protocol = secure ? 'https' : 'http'
  const host = preview ? 'preview.contentful.com' : 'cdn.contentful.com'
  return `${protocol}://${host}/${path}`
}

function handleError(err, req, res) {
  sendError(req, res, err)
}

const spaceId = process.env.CONTENTFUL_SPACE_ID;
if(!spaceId){
  throw new Error('Missing process.env.CONTENTFUL_SPACE_ID');
}
const accessToken = process.env.CONTENTFUL_ACCESS_TOKEN;
if(!accessToken){
  throw new Error('Missing process.env.CONTENTFUL_ACCESS_TOKEN');
}
module.exports = createProxyFn({
  spaceId,
  accessToken,
  //previewToken
  preview: false,
  secure: true
})
