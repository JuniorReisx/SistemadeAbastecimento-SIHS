import { React, getAppStore } from 'jimu-core'
import { loadArcGISJSAPIModules } from 'jimu-arcgis'
import { captacaoGrupo, clean, fold, sqlEscape, yearOf, type CensoMun, type Sistema } from './data'

export const WEBMAP_ID = '3dceccbfaa5d492f9729eca8d69816cd'
export const PORTAL_URL = 'https://portaldaagua.sihs.ba.gov.br/portal'

const SISTEMA_FIELDS = [
  'objectid',
  'localidade',
  'municipio',
  'tipo_sistema',
  'captacao',
  'populacao_atendida',
  'data'
]

const toArray = (collection: any): any[] => {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (typeof collection.toArray === 'function') return collection.toArray()
  const items: any[] = []
  collection.forEach?.((item: any) => items.push(item))
  return items
}

const findLayer = (webmap: any, test: (title: string) => boolean) => {
  return toArray(webmap?.allLayers).find((layer) => test(fold(layer?.title)))
}

const readNumber = (value: unknown) => {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

const attrByName = (attrs: any, name: string) => {
  if (!attrs) return null
  if (name in attrs) return attrs[name]
  const key = Object.keys(attrs).find((item) => item.toLowerCase() === name.toLowerCase())
  return key ? attrs[key] : null
}

const toSistema = (feature: any): Sistema => {
  const attrs = feature?.attributes || {}
  const implantacao = readNumber(attrs.data)
  const original = clean(attrs.captacao)
  return {
    id: Number(attrs.objectid),
    localidade: clean(attrs.localidade) || 'Sem localidade',
    municipio: clean(attrs.municipio) || 'Não informado',
    tipo: clean(attrs.tipo_sistema) || 'NÃO INFORMADO',
    captacao: captacaoGrupo(original),
    captacaoOriginal: original,
    populacao: readNumber(attrs.populacao_atendida),
    implantacao,
    ano: yearOf(implantacao),
    latitude: readNumber(attrByName(attrs, 'y')),
    longitude: readNumber(attrByName(attrs, 'x'))
  }
}

const toCenso = (feature: any): CensoMun | null => {
  const attrs = feature?.attributes || {}
  const nome = clean(attrs.nome_do_municipio)
  if (!nome) return null
  return {
    nome,
    chave: fold(nome),
    populacao: readNumber(attrs.estimativa_pop_2025) || 0,
    domicilios: readNumber(attrs['total_domicílios_recenseados__2']) || 0
  }
}

const LAYER_WATCH_MS = 3 * 60 * 1000

const readLayerUpdatedAt = async (layer: any, request: any, portalUrl: string) => {
  const layerUrl = String(layer?.url || '')
  if (!layerUrl) return null
  const serviceUrl = layerUrl.replace(/\/\d+\/?$/, '')
  const service = await request(serviceUrl, { query: { f: 'json' }, responseType: 'json' })
  const itemId = service?.data?.serviceItemId || layer?.portalItem?.id
  if (!itemId) return null
  const item = await request(`${portalUrl.replace(/\/$/, '')}/sharing/rest/content/items/${itemId}`, {
    query: { f: 'json' },
    responseType: 'json'
  })
  const modified = Number(item?.data?.modified)
  return Number.isFinite(modified) && modified > 0 ? modified : null
}

const coordFieldNames = (layer: any) => {
  const names: string[] = (layer?.fields || []).map((field: any) => field?.name).filter(Boolean)
  return ['x', 'y'].map((wanted) => names.find((name) => name.toLowerCase() === wanted) || wanted)
}

const queryAll = async (layer: any, outFields: string[]) => {
  await layer.load?.()
  const fields = Array.from(new Set([...outFields, ...coordFieldNames(layer)]))
  const count = await layer.queryFeatureCount({ where: '1=1' })
  const size = Math.min(layer.maxRecordCount || 1000, 2000)
  const features: any[] = []
  const order = layer.objectIdField || 'objectid'
  for (let start = 0; start < Math.max(count, 1); start += size) {
    const result = await layer.queryFeatures({
      where: '1=1',
      outFields: fields,
      returnGeometry: false,
      num: size,
      start,
      orderByFields: [order]
    })
    const page = result?.features || []
    features.push(...page)
    if (!page.length || features.length >= count) break
  }
  return features
}

export const useSistemasWebMap = (
  containerRef: { current: HTMLDivElement | null },
  onSelect: (id: number | null) => void,
  onMunicipioRef: { current: (nome: string) => void }
) => {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [systems, setSystems] = React.useState<Sistema[]>([])
  const [census, setCensus] = React.useState<CensoMun[]>([])
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null)
  const [spatialIds, setSpatialIds] = React.useState<number[] | null>(null)
  const projectionRef = React.useRef<any>(null)
  const viewRef = React.useRef<any>(null)
  const homeExtentRef = React.useRef<any>(null)
  const sistemasRef = React.useRef<any>(null)
  const censoRef = React.useRef<any>(null)
  const highlightRef = React.useRef<any>(null)
  const munHighlightRef = React.useRef<any>(null)
  const outlineRef = React.useRef<any>(null)
  const graphicCtorRef = React.useRef<any>(null)
  const munGraphicsRef = React.useRef<any[]>([])
  const markGraphicsRef = React.useRef<any[]>([])
  const selectedRef = React.useRef<number | null>(null)
  const beforeRef = React.useRef<any>(null)
  const whereRef = React.useRef('1=1')
  const spatialGeometryRef = React.useRef<any>(null)
  const onSelectRef = React.useRef(onSelect)
  onSelectRef.current = onSelect

  const clearMarkOutline = () => {
    const layer = outlineRef.current
    markGraphicsRef.current.forEach((item) => layer?.remove?.(item))
    markGraphicsRef.current = []
  }

  const clearHighlight = React.useCallback(() => {
    highlightRef.current?.remove?.()
    highlightRef.current = null
    clearMarkOutline()
  }, [])

  const applyWhere = React.useCallback((where: string) => {
    whereRef.current = where || '1=1'
    const layer = sistemasRef.current
    if (!layer) return
    layer.definitionExpression = whereRef.current === '1=1' ? null : whereRef.current
  }, [])

  const rememberView = () => {
    const view = viewRef.current
    if (!view || beforeRef.current) return
    beforeRef.current = view.viewpoint?.clone?.() || view.extent?.clone?.() || null
  }

  const goBack = async () => {
    const view = viewRef.current
    const back = beforeRef.current || homeExtentRef.current
    beforeRef.current = null
    if (view && back) await view.goTo(back, { duration: 650 }).catch(() => undefined)
  }

  const clearMark = React.useCallback(() => {
    clearHighlight()
    selectedRef.current = null
    beforeRef.current = null
  }, [clearHighlight])

  const releaseSistema = React.useCallback(async () => {
    clearHighlight()
    selectedRef.current = null
    await goBack()
  }, [clearHighlight])

  const zoomToSistema = React.useCallback(async (id: number) => {
    const view = viewRef.current
    const layer = sistemasRef.current
    if (!view || !layer || !Number.isFinite(id)) return
    try {
      const oid = layer.objectIdField || 'objectid'
      const result = await layer.queryFeatures({
        where: `${oid} = ${id}`,
        outFields: [oid],
        returnGeometry: true
      })
      const graphic = result?.features?.[0]
      if (!graphic) return
      const layerView = await view.whenLayerView(layer)
      rememberView()
      selectedRef.current = id
      clearHighlight()
      highlightRef.current = layerView?.highlight?.(graphic)
      const Graphic = graphicCtorRef.current
      const outline = outlineRef.current
      if (Graphic && outline && graphic.geometry) {
        const halo = new Graphic({
          geometry: graphic.geometry,
          symbol: { type: 'simple-marker', style: 'circle', color: [0, 0, 0, 0], size: 28, outline: { color: [255, 255, 255, 0.95], width: 5 } }
        })
        const ring = new Graphic({
          geometry: graphic.geometry,
          symbol: { type: 'simple-marker', style: 'circle', color: [0, 0, 0, 0], size: 22, outline: { color: [4, 54, 74, 1], width: 3 } }
        })
        outline.addMany([halo, ring])
        markGraphicsRef.current = [halo, ring]
      }
      await view.goTo({ target: graphic, zoom: Math.max(view.zoom || 0, 13) }, { duration: 700 })
    } catch (_err) {}
  }, [clearHighlight])

  const focusSistema = React.useCallback(async (id: number) => {
    if (selectedRef.current === id) {
      onSelectRef.current(null)
      await releaseSistema()
      return
    }
    onSelectRef.current(id)
    await zoomToSistema(id)
  }, [releaseSistema, zoomToSistema])

  const focusRef = React.useRef(focusSistema)
  const releaseRef = React.useRef(releaseSistema)
  focusRef.current = focusSistema
  releaseRef.current = releaseSistema

  const resize = React.useCallback(() => {
    viewRef.current?.resize?.()
  }, [])

  const clearMunHighlight = () => {
    const layer = outlineRef.current
    munGraphicsRef.current.forEach((item) => layer?.remove?.(item))
    munGraphicsRef.current = []
    munHighlightRef.current?.remove?.()
    munHighlightRef.current = null
  }

  const projectTo = async (geometry: any, spatialReference: any) => {
    if (!geometry || !spatialReference) return geometry
    const from = geometry.spatialReference?.latestWkid || geometry.spatialReference?.wkid
    const to = spatialReference.latestWkid || spatialReference.wkid
    if (from && from === to) return geometry
    const projection = projectionRef.current
    if (!projection) return geometry
    if (!projection.isLoaded()) await projection.load()
    return projection.project(geometry, spatialReference) || geometry
  }

  const applySpatialMunicipio = async (geometry: any | null) => {
    spatialGeometryRef.current = geometry
    const view = viewRef.current
    const layer = sistemasRef.current
    if (view && layer) {
      const layerView = await view.whenLayerView(layer)
      const filterGeometry = geometry ? await projectTo(geometry, view.spatialReference) : null
      if (layerView) {
        layerView.filter = filterGeometry
          ? { geometry: filterGeometry, spatialRelationship: 'intersects' }
          : null
      }
    }
    if (!geometry || !layer) {
      setSpatialIds(null)
      return
    }
    const expression = layer.definitionExpression
    layer.definitionExpression = null
    try {
      const queryGeometry = await projectTo(geometry, layer.spatialReference)
      const ids = await layer.queryObjectIds({
        geometry: queryGeometry,
        spatialRelationship: 'intersects',
        where: '1=1'
      })
      setSpatialIds((ids || []).map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id)))
    } catch (_err) {
      setSpatialIds([])
    } finally {
      layer.definitionExpression = expression && expression !== '1=1' ? expression : (whereRef.current === '1=1' ? null : whereRef.current)
    }
  }

  const zoomToMunicipio = React.useCallback(async (nome: string) => {
    const view = viewRef.current
    const layer = censoRef.current
    if (!view) return
    if (!nome) {
      clearMunHighlight()
      await applySpatialMunicipio(null)
      const home = homeExtentRef.current
      if (home) await view.goTo(home, { duration: 700 }).catch(() => undefined)
      return
    }
    if (!layer || typeof layer.queryFeatures !== 'function') return
    try {
      const result = await layer.queryFeatures({
        where: `UPPER(nome_do_municipio) = '${sqlEscape(nome.toUpperCase())}'`,
        outFields: ['nome_do_municipio'],
        returnGeometry: true
      })
      const graphic = result?.features?.[0]
      if (!graphic?.geometry?.extent || graphic.geometry.extent.isEmpty) {
        await applySpatialMunicipio(null)
        setSpatialIds([])
        return
      }
      await applySpatialMunicipio(graphic.geometry)
      clearMunHighlight()
      const Graphic = graphicCtorRef.current
      const outline = outlineRef.current
      if (Graphic && outline) {
        const halo = new Graphic({
          geometry: graphic.geometry,
          symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [255, 255, 255, 0.95], width: 7 } }
        })
        const contour = new Graphic({
          geometry: graphic.geometry,
          symbol: { type: 'simple-fill', color: [22, 166, 192, 0.16], outline: { color: [4, 54, 74, 1], width: 3 } }
        })
        outline.addMany([halo, contour])
        munGraphicsRef.current = [halo, contour]
      }
      await view.goTo(graphic.geometry.extent.clone().expand(1.6), { duration: 700 })
    } catch (_err) {}
  }, [])

  React.useEffect(() => {
    let cancelled = false
    let clickHandle: any
    let watchTimer = 0

    const start = async () => {
      const node = containerRef.current
      if (!node) {
        window.setTimeout(() => { if (!cancelled) start() }, 60)
        return
      }
      setLoading(true)
      setError('')

      try {
        const [esriConfig, Portal, WebMap, MapView, Home, GraphicsLayer, Graphic, esriRequest, projection] = await loadArcGISJSAPIModules([
          'esri/config',
          'esri/portal/Portal',
          'esri/WebMap',
          'esri/views/MapView',
          'esri/widgets/Home',
          'esri/layers/GraphicsLayer',
          'esri/Graphic',
          'esri/request',
          'esri/geometry/projection'
        ])

        projectionRef.current = projection
        const portalUrl = getAppStore().getState()?.portalUrl || PORTAL_URL
        esriConfig.portalUrl = portalUrl
        const portal = new Portal({ url: portalUrl, authMode: 'auto' })
        await portal.load()

        const webmap = new WebMap({ portalItem: { id: WEBMAP_ID, portal } })
        await webmap.load()
        await webmap.loadAll()
        if (cancelled) return

        const sistemas = findLayer(webmap, (title) => title.includes('tipos de sistema') || title.includes('sistemas de abastecimento'))
        const censo = findLayer(webmap, (title) => title.includes('censo') || title.includes('municipios_2026') || title.includes('municipios 2026'))
        if (!sistemas) throw new Error('A camada Tipos de Sistema não está no Web Map.')
        sistemasRef.current = sistemas
        censoRef.current = censo

        const view = new MapView({
          container: node,
          map: webmap,
          ui: { components: ['zoom', 'attribution'] }
        })
        if ('popupEnabled' in view) view.popupEnabled = false
        else if (view.popup) view.popup.autoOpenEnabled = false
        viewRef.current = view
        await view.when()
        if (cancelled) return

        const stateLayer = censo || sistemas
        try {
          const extentResult = await stateLayer.queryExtent?.({ where: '1=1' })
          const extent = extentResult?.extent
          if (extent && !extent.isEmpty) {
            const bahia = extent.clone().expand(1.08)
            homeExtentRef.current = bahia
            view.resize?.()
            await view.goTo(bahia, { animate: false })
          }
        } catch (_err) {}
        const outline = new GraphicsLayer({ listMode: 'hide', title: 'Seleção' })
        webmap.add(outline)
        outlineRef.current = outline
        graphicCtorRef.current = Graphic
        view.ui.add(new Home({ view, viewpoint: view.viewpoint?.clone?.() || view.viewpoint }), 'top-left')

        const loadSystems = async () => {
          const expression = sistemas.definitionExpression
          sistemas.definitionExpression = null
          try {
            const features = await queryAll(sistemas, SISTEMA_FIELDS)
            if (cancelled) return
            setSystems(features.map(toSistema).filter((item) => Number.isFinite(item.id)))
          } finally {
            sistemas.definitionExpression = expression && expression !== '1=1' ? expression : (whereRef.current === '1=1' ? null : whereRef.current)
          }
        }

        await loadSystems()
        if (cancelled) return
        const stampRef = { current: null as number | null }
        const watchLayer = async () => {
          try {
            const stamp = await readLayerUpdatedAt(sistemas, esriRequest, portalUrl)
            if (cancelled || stamp == null) return
            const changed = stampRef.current != null && stamp !== stampRef.current
            stampRef.current = stamp
            setUpdatedAt(stamp)
            if (!changed) return
            sistemas.refresh?.()
            await loadSystems()
            if (spatialGeometryRef.current) await applySpatialMunicipio(spatialGeometryRef.current)
          } catch (_err) {}
        }
        await watchLayer()
        watchTimer = window.setInterval(watchLayer, LAYER_WATCH_MS)

        if (censo) {
          try {
            await censo.load?.()
            const censusFeatures = await censo.queryFeatures({
              where: '1=1',
              outFields: ['nome_do_municipio', 'estimativa_pop_2025', 'total_domicílios_recenseados__2'],
              returnGeometry: false
            })
            if (!cancelled) {
              setCensus((censusFeatures?.features || []).map(toCenso).filter(Boolean) as CensoMun[])
            }
          } catch (_err) {}
        }

        clickHandle = view.on('click', async (event: any) => {
          const hit = await view.hitTest(event)
          const graphic = hit?.results?.find((item: any) => item.graphic?.layer === sistemas)?.graphic
          if (graphic) {
            const id = Number(graphic.attributes?.[sistemas.objectIdField || 'objectid'])
            if (Number.isFinite(id)) focusRef.current(id)
            return
          }
          if (censo && event.mapPoint) {
            try {
              const result = await censo.queryFeatures({
                geometry: event.mapPoint,
                spatialRelationship: 'intersects',
                outFields: ['nome_do_municipio'],
                returnGeometry: false
              })
              const nome = clean(result?.features?.[0]?.attributes?.nome_do_municipio)
              if (nome) {
                if (selectedRef.current != null) {
                  clearHighlight()
                  selectedRef.current = null
                  beforeRef.current = null
                  onSelectRef.current(null)
                }
                onMunicipioRef.current(nome)
                return
              }
            } catch (_err) {}
          }
          if (selectedRef.current != null) {
            onSelectRef.current(null)
            releaseRef.current()
          }
        })

        setLoading(false)
      } catch (err: any) {
        if (cancelled) return
        const message = String(err?.message || err || '')
        const denied = /permission|403|sign|login|credential|unauthorized|token/i.test(message)
        setError(denied
          ? 'O Web Map é da organização. Entre com um usuário SIHS para carregar os sistemas.'
          : message || 'Não foi possível carregar o Web Map.')
        setLoading(false)
      }
    }

    start()

    return () => {
      cancelled = true
      window.clearInterval(watchTimer)
      clickHandle?.remove?.()
      highlightRef.current?.remove?.()
      munHighlightRef.current?.remove?.()
      outlineRef.current = null
      graphicCtorRef.current = null
      munGraphicsRef.current = []
      markGraphicsRef.current = []
      viewRef.current?.destroy?.()
      viewRef.current = null
      sistemasRef.current = null
      censoRef.current = null
    }
  }, [containerRef, clearHighlight])

  return { loading, error, systems, census, updatedAt, spatialIds, applyWhere, zoomToSistema, releaseSistema, clearMark, zoomToMunicipio, resize }
}
