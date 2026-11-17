export const TIPO_ORDEM = [
  'SISTEMA SIMPLIFICADO',
  'INTEGRADO',
  'SISTEMA CONVENCIONAL',
  'INSTALAÇÃO BOCA DE POÇO',
  'NÃO INFORMADO'
]

export const TIPO_COR: Record<string, string> = {
  'SISTEMA SIMPLIFICADO': '#2f6fe0',
  INTEGRADO: '#16a6c0',
  'SISTEMA CONVENCIONAL': '#2f9b57',
  'INSTALAÇÃO BOCA DE POÇO': '#e07a3d',
  'NÃO INFORMADO': '#8aa0ad',
  Outros: '#7b5cc4'
}

export const CAPTACAO_ORDEM = [
  'POÇO TUBULAR',
  'RIO',
  'BARRAGEM',
  'ADUTORA',
  'MISTA',
  'OUTROS',
  'NÃO INFORMADO'
]

export const CAPTACAO_COR: Record<string, string> = {
  'POÇO TUBULAR': '#2f6fe0',
  RIO: '#16a6c0',
  BARRAGEM: '#2f9b57',
  ADUTORA: '#7b5cc4',
  MISTA: '#e0a21a',
  OUTROS: '#e07a3d',
  'NÃO INFORMADO': '#8aa0ad'
}

export interface Sistema {
  id: number
  localidade: string
  municipio: string
  tipo: string
  captacao: string
  captacaoOriginal: string
  populacao: number | null
  implantacao: number | null
  ano: number | null
  latitude: number | null
  longitude: number | null
}

export interface CensoMun {
  nome: string
  chave: string
  populacao: number
  domicilios: number
}

export interface Slice {
  key: string
  label: string
  value: number
  color: string
}

export const fold = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

export const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()

export const sqlEscape = (value: string) => String(value || '').replace(/'/g, "''")

export const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR').format(Math.round(value || 0))

export const formatPopulacao = (value: number | null) => {
  if (value == null || !Number.isFinite(value) || value < 0) return '—'
  return `${formatNumber(value)} hab.`
}

export const formatUpdatedMonth = (value: number | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'America/Bahia' })
    .format(date)
    .replace('.', '')
  const year = new Intl.DateTimeFormat('pt-BR', { year: 'numeric', timeZone: 'America/Bahia' }).format(date)
  return `${month}/${year}`
}

export const formatCoord = (value: number | null) => {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 5, maximumFractionDigits: 6 }).format(value)
}

export const formatDate = (value: number | null) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${date.getUTCFullYear()}`
}

export const titleCase = (value: string) => {
  const text = clean(value)
  if (!text) return 'Não informado'
  return text
    .toLowerCase()
    .split(' ')
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
    .join(' ')
}

export const yearOf = (value: number | null) => {
  if (!value) return null
  const year = new Date(value).getUTCFullYear()
  return year >= 1900 && year <= 2035 ? year : null
}

export const uniqueSorted = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'))

export const captacaoGrupo = (value: string) => {
  const text = fold(value)
  if (!text || text === '<nulo>' || text === '<null>' || text === 'null') return 'NÃO INFORMADO'
  const kinds: string[] = []
  if (text.includes('poco') || text.includes('cacimba') || text.includes('minacao')) kinds.push('POÇO')
  if (text.includes('rio') || text.includes('riacho') || text.includes('nascente')) kinds.push('RIO')
  if (text.includes('barragem') || text.includes('acude')) kinds.push('BARRAGEM')
  if (text.includes('adutora')) kinds.push('ADUTORA')
  if (!kinds.length) return 'OUTROS'
  if (kinds.length > 1) return 'MISTA'
  if (kinds[0] === 'POÇO') return 'POÇO TUBULAR'
  return kinds[0]
}

export const captacaoWhere = (group: string, raws: string[]) => {
  const matched = raws.filter((item) => captacaoGrupo(item) === group)
  const parts = matched.map((item) => `captacao = '${sqlEscape(item)}'`)
  if (group === 'NÃO INFORMADO') parts.push('captacao IS NULL')
  return parts.length ? `(${parts.join(' OR ')})` : '1=0'
}

const slicesOf = (rows: Sistema[], keyOf: (row: Sistema) => string, order: string[], colors: Record<string, string>): Slice[] => {
  const counts = new Map<string, number>()
  rows.forEach((row) => {
    const key = keyOf(row) || 'NÃO INFORMADO'
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  const head = order.map((key) => ({
    key,
    label: titleCase(key),
    value: counts.get(key) || 0,
    color: colors[key]
  })).filter((item) => item.value > 0)
  let outros = 0
  counts.forEach((value, key) => {
    if (!order.includes(key)) outros += value
  })
  if (outros) head.push({ key: 'Outros', label: 'Outros', value: outros, color: colors.Outros || '#7b5cc4' })
  return head
}

export const tipoSlices = (rows: Sistema[]) => slicesOf(rows, (row) => row.tipo, TIPO_ORDEM, TIPO_COR)

export const captacaoSlices = (rows: Sistema[]) => slicesOf(rows, (row) => row.captacao, CAPTACAO_ORDEM, CAPTACAO_COR)

export type RankMetric = 'populacao' | 'maior' | 'quantidade'

export interface MunRank {
  nome: string
  sistemas: number
  populacao: number
  maiorPop: number
  maior: Sistema | null
}

export const rankMunicipios = (rows: Sistema[], metric: RankMetric): MunRank[] => {
  const groups = new Map<string, MunRank>()
  rows.forEach((row) => {
    const current = groups.get(row.municipio) || {
      nome: row.municipio,
      sistemas: 0,
      populacao: 0,
      maiorPop: 0,
      maior: null
    }
    current.sistemas += 1
    current.populacao += row.populacao || 0
    if ((row.populacao || 0) > current.maiorPop) {
      current.maiorPop = row.populacao || 0
      current.maior = row
    }
    groups.set(row.municipio, current)
  })
  return Array.from(groups.values()).sort((a, b) => {
    if (metric === 'quantidade') return b.sistemas - a.sistemas || b.populacao - a.populacao
    if (metric === 'maior') return b.maiorPop - a.maiorPop || b.populacao - a.populacao
    return b.populacao - a.populacao || b.sistemas - a.sistemas
  })
}

export const rankValue = (item: MunRank, metric: RankMetric) => {
  if (metric === 'quantidade') return item.sistemas
  if (metric === 'maior') return item.maiorPop
  return item.populacao
}

export const topSistemas = (rows: Sistema[], limit = 12) => {
  return rows
    .filter((row) => (row.populacao || 0) > 0)
    .sort((a, b) => (b.populacao || 0) - (a.populacao || 0))
    .slice(0, limit)
}

const csvText = (value: string) => `"${value.replace(/"/g, '""')}"`

const csvNumber = (value: number | null) => {
  if (value == null || !Number.isFinite(value)) return ''
  return String(value).replace('.', ',')
}

const csvDate = (value: number | null) => {
  const text = formatDate(value)
  return text === '—' ? '' : text
}

export const downloadSistemasPlanilha = (rows: Sistema[]) => {
  const header = ['Localidade', 'Município', 'Tipo', 'Captação', 'População', 'Data', 'Latitude', 'Longitude']
  const lines = [header.map(csvText).join(';')]
  rows.forEach((row) => {
    lines.push([
      csvText(row.localidade),
      csvText(row.municipio),
      csvText(row.tipo),
      csvText(row.captacao),
      csvNumber(row.populacao),
      csvText(csvDate(row.implantacao)),
      csvNumber(row.latitude),
      csvNumber(row.longitude)
    ].join(';'))
  })
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `sistemas-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export const yearCounts = (rows: Sistema[]) => {
  const counts = new Map<number, number>()
  rows.forEach((row) => {
    if (!row.ano) return
    counts.set(row.ano, (counts.get(row.ano) || 0) + 1)
  })
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, value]) => ({ year, value }))
}
