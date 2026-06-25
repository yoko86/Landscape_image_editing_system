import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'

type FilterParams = {
  h_w: number
  s_w: number
  v_w: number
}

type SavedWord = {
  word: string
  params: FilterParams
}

type Candidate = {
  id: string
  params: FilterParams
  previewUrl: string
}

type HSV = {
  h: number
  s: number
  v: number
}

const GRID_SIZE = 5
const PATCH_ALPHA = 85 / 255
const INITIAL_HUES = [20, 60, 120, 180, -60, -120]
const NEARBY_CANDIDATE_RANGES = [
  { sMin: -1.0, sMax: -0.5, vMin: -1.0, vMax: -0.5 },
  { sMin: -0.5, sMax: 0.3, vMin: -0.5, vMax: 0.3 },
  { sMin: -0.3, sMax: 0.0, vMin: -0.3, vMax: 0.0 },
  { sMin: 0.0, sMax: 0.3, vMin: 0.0, vMax: 0.3 },
  { sMin: 0.3, sMax: 0.5, vMin: 0.3, vMax: 0.5 },
  { sMin: 0.5, sMax: 1.0, vMin: 0.5, vMax: 1.0 },
]

const zeroParams: FilterParams = { h_w: 0, s_w: 0, v_w: 0 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wrapHueDegrees(hue: number): number {
  let h = hue % 360
  if (h < 0) h += 360
  return h
}

function toSignedHueRange(hue: number): number {
  const wrapped = ((hue + 180) % 360 + 360) % 360 - 180
  return wrapped
}

function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const diff = max - min

  let h = 0
  if (diff !== 0) {
    if (max === rn) {
      h = 60 * (((gn - bn) / diff) % 6)
    } else if (max === gn) {
      h = 60 * ((bn - rn) / diff + 2)
    } else {
      h = 60 * ((rn - gn) / diff + 4)
    }
  }

  if (h < 0) h += 360

  const s = max === 0 ? 0 : diff / max
  const v = max

  return { h, s, v }
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const hh = h / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const m = v - c

  let r1 = 0
  let g1 = 0
  let b1 = 0

  if (hh >= 0 && hh < 1) {
    r1 = c
    g1 = x
  } else if (hh >= 1 && hh < 2) {
    r1 = x
    g1 = c
  } else if (hh >= 2 && hh < 3) {
    g1 = c
    b1 = x
  } else if (hh >= 3 && hh < 4) {
    g1 = x
    b1 = c
  } else if (hh >= 4 && hh < 5) {
    r1 = x
    b1 = c
  } else {
    r1 = c
    b1 = x
  }

  const r = Math.round((r1 + m) * 255)
  const g = Math.round((g1 + m) * 255)
  const b = Math.round((b1 + m) * 255)

  return [r, g, b]
}

function buildPreviewDataUrl(
  image: HTMLImageElement,
  params: FilterParams,
  options?: {
    fixedSaturation?: number
    preserveValue?: boolean
  },
): string {
  const width = image.naturalWidth
  const height = image.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  if (!ctx) return ''

  ctx.drawImage(image, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  const pixels = imageData.data

  for (let gy = 0; gy < GRID_SIZE; gy += 1) {
    const yStart = Math.floor((gy * height) / GRID_SIZE)
    const yEnd = Math.floor(((gy + 1) * height) / GRID_SIZE)
    for (let gx = 0; gx < GRID_SIZE; gx += 1) {
      const xStart = Math.floor((gx * width) / GRID_SIZE)
      const xEnd = Math.floor(((gx + 1) * width) / GRID_SIZE)

      let rSum = 0
      let gSum = 0
      let bSum = 0
      let count = 0

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const idx = (y * width + x) * 4
          rSum += pixels[idx]
          gSum += pixels[idx + 1]
          bSum += pixels[idx + 2]
          count += 1
        }
      }

      const avgR = Math.round(rSum / count)
      const avgG = Math.round(gSum / count)
      const avgB = Math.round(bSum / count)

      const hsv = rgbToHsv(avgR, avgG, avgB)
      const transformedH = wrapHueDegrees(hsv.h + params.h_w)
      const transformedS = clamp(
        options?.fixedSaturation ?? hsv.s + params.s_w,
        0,
        1,
      )
      const transformedV = options?.preserveValue
        ? hsv.v
        : clamp(hsv.v + params.v_w, 0, 1)
      const [rPatch, gPatch, bPatch] = hsvToRgb(
        transformedH,
        transformedS,
        transformedV,
      )

      ctx.fillStyle = `rgba(${rPatch}, ${gPatch}, ${bPatch}, ${PATCH_ALPHA})`
      ctx.fillRect(xStart, yStart, xEnd - xStart, yEnd - yStart)
    }
  }

  return canvas.toDataURL('image/png')
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function createNearbyCandidateParams(selected: FilterParams): FilterParams[] {
  return [
    selected,
    ...NEARBY_CANDIDATE_RANGES.slice(0, 5).map((range) => ({
      h_w: clamp(toSignedHueRange(selected.h_w + randomInRange(-5, 5)), -180, 180),
      s_w: clamp(randomInRange(range.sMin, range.sMax), -1, 1),
      v_w: clamp(randomInRange(range.vMin, range.vMax), -1, 1),
    })),
  ]
}

function nearlySameParams(a: FilterParams, b: FilterParams): boolean {
  return (
    Math.abs(a.h_w - b.h_w) < 1e-6 &&
    Math.abs(a.s_w - b.s_w) < 1e-6 &&
    Math.abs(a.v_w - b.v_w) < 1e-6
  )
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createInitialCandidates(sourceImage: HTMLImageElement): Candidate[] {
  return INITIAL_HUES.map((hue) => {
    const params: FilterParams = {
      h_w: hue,
      s_w: 0.8,
      v_w: 0,
    }

    return {
      id: makeId(),
      params,
      previewUrl: buildPreviewDataUrl(sourceImage, params, {
        fixedSaturation: 0.8,
        preserveValue: true,
      }),
    }
  })
}

function App() {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)

  const [leftParams, setLeftParams] = useState<FilterParams>(zeroParams)
  const [leftPreviewUrl, setLeftPreviewUrl] = useState<string>('')
  const [manualApplyUrl, setManualApplyUrl] = useState<string | null>(null)
  const [manualApplyImage, setManualApplyImage] = useState<HTMLImageElement | null>(null)
  const [manualApplyPreviewUrl, setManualApplyPreviewUrl] = useState<string>('')

  const [phase, setPhase] = useState<'tuning' | 'edit'>('tuning')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [bestParams, setBestParams] = useState<FilterParams | null>(null)
  const [, setGeneration] = useState(1)
  const [wordName] = useState('レトロな')

  const [savedWords, setSavedWords] = useState<SavedWord[]>([])
  const [appliedWordIndex, setAppliedWordIndex] = useState<number>(-1)
  const [rightPreviewUrl, setRightPreviewUrl] = useState<string>('')
  const [proposalApplyUrl, setProposalApplyUrl] = useState<string | null>(null)
  const [proposalApplyImage, setProposalApplyImage] = useState<HTMLImageElement | null>(null)
  const [proposalApplyPreviewUrl, setProposalApplyPreviewUrl] = useState<string>('')

  const [statusText, setStatusText] = useState(
    '画像をアップロードすると比較を開始できます。',
  )

  const appliedParams = useMemo(() => {
    if (appliedWordIndex < 0 || appliedWordIndex >= savedWords.length) {
      return null
    }
    return savedWords[appliedWordIndex].params
  }, [appliedWordIndex, savedWords])

  useEffect(() => {
    if (!originalUrl) {
      setSourceImage(null)
      return
    }

    const img = new Image()
    img.onload = () => {
      setSourceImage(img)
    }
    img.src = originalUrl
  }, [originalUrl])

  useEffect(() => {
    if (!sourceImage) {
      setLeftPreviewUrl('')
      return
    }
    setLeftPreviewUrl(buildPreviewDataUrl(sourceImage, leftParams))
  }, [leftParams, sourceImage])

  useEffect(() => {
    if (!manualApplyUrl) {
      setManualApplyImage(null)
      return
    }

    const img = new Image()
    img.onload = () => {
      setManualApplyImage(img)
    }
    img.src = manualApplyUrl
  }, [manualApplyUrl])

  useEffect(() => {
    if (!manualApplyImage) {
      setManualApplyPreviewUrl('')
      return
    }

    setManualApplyPreviewUrl(buildPreviewDataUrl(manualApplyImage, leftParams))
  }, [leftParams, manualApplyImage])

  useEffect(() => {
    if (!sourceImage || !appliedParams) {
      setRightPreviewUrl('')
      return
    }
    setRightPreviewUrl(buildPreviewDataUrl(sourceImage, appliedParams))
  }, [appliedParams, sourceImage])

  useEffect(() => {
    if (!sourceImage) {
      setCandidates([])
      setPhase('tuning')
      setBestParams(null)
      setGeneration(1)
      return
    }

    const initialCandidates = createInitialCandidates(sourceImage)

    setCandidates(initialCandidates)
    setPhase('tuning')
    setGeneration(1)
    setBestParams(null)
    setSavedWords([])
    setAppliedWordIndex(-1)
    setRightPreviewUrl('')
    setStatusText('フェーズ1: 6枚から最も好みの画像を選択してください。')
  }, [sourceImage])

  useEffect(() => {
    if (!proposalApplyUrl) {
      setProposalApplyImage(null)
      return
    }

    const img = new Image()
    img.onload = () => {
      setProposalApplyImage(img)
    }
    img.src = proposalApplyUrl
  }, [proposalApplyUrl])

  useEffect(() => {
    if (!proposalApplyImage || !appliedParams) {
      setProposalApplyPreviewUrl('')
      return
    }

    setProposalApplyPreviewUrl(buildPreviewDataUrl(proposalApplyImage, appliedParams))
  }, [appliedParams, proposalApplyImage])

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (originalUrl) {
      URL.revokeObjectURL(originalUrl)
    }

    const nextUrl = URL.createObjectURL(file)
    setOriginalUrl(nextUrl)
    setLeftParams(zeroParams)
  }

  const handleManualApplyUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (manualApplyUrl) {
      URL.revokeObjectURL(manualApplyUrl)
    }

    setManualApplyUrl(URL.createObjectURL(file))
  }

  const handleProposalApplyUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (proposalApplyUrl) {
      URL.revokeObjectURL(proposalApplyUrl)
    }

    setProposalApplyUrl(URL.createObjectURL(file))
  }

  const resetAll = () => {
    if (originalUrl) {
      URL.revokeObjectURL(originalUrl)
    }
    setOriginalUrl(null)
    setSourceImage(null)
    setLeftParams(zeroParams)
    setLeftPreviewUrl('')
    setCandidates([])
    setBestParams(null)
    setGeneration(1)
    setSavedWords([])
    setAppliedWordIndex(-1)
    setRightPreviewUrl('')
    if (manualApplyUrl) {
      URL.revokeObjectURL(manualApplyUrl)
    }
    if (proposalApplyUrl) {
      URL.revokeObjectURL(proposalApplyUrl)
    }
    setManualApplyUrl(null)
    setManualApplyImage(null)
    setManualApplyPreviewUrl('')
    setProposalApplyUrl(null)
    setProposalApplyImage(null)
    setProposalApplyPreviewUrl('')
    setPhase('tuning')
    setStatusText('画像をアップロードすると比較を開始できます。')
  }

  const generateNextCandidates = (selected: FilterParams) => {
    if (!sourceImage) return

    const nextParams = createNearbyCandidateParams(selected)

    const nextCandidates: Candidate[] = nextParams.map((params) => ({
      id: makeId(),
      params,
      previewUrl: buildPreviewDataUrl(sourceImage, params),
    }))

    setCandidates(nextCandidates)
    setGeneration((prev) => prev + 1)
  }

  const handleCandidateSelect = (candidate: Candidate) => {
    if (!sourceImage || phase !== 'tuning') return

    if (bestParams && nearlySameParams(candidate.params, bestParams)) {
      const finalWord = wordName.trim() || `ワード${savedWords.length + 1}`
      const newWord: SavedWord = { word: finalWord, params: candidate.params }

      setSavedWords((prev) => [...prev, newWord])
      setAppliedWordIndex(savedWords.length)
      setPhase('edit')
      setStatusText(
        `収束しました。${finalWord} を保存し、フェーズ2に移行しました。`,
      )
      return
    }

    setBestParams(candidate.params)
    generateNextCandidates(candidate.params)
    setStatusText(
      '次世代を生成しました。前回と同じ画像を再度選ぶとチューニングを終了します。',
    )
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-actions">
          <label className="upload-btn">
            画像アップロード
            <input type="file" accept="image/*" onChange={handleUpload} />
          </label>
          <button type="button" className="reset-btn" onClick={resetAll}>
            リセット
          </button>
        </div>
        <p className="status">{statusText}</p>
      </header>

      <main className="split-layout">
        <section className="panel left-panel">
          <h2>手動調整</h2>
          <div className="preview-wrap large">
            {leftPreviewUrl ? (
              <img src={leftPreviewUrl} alt="既存手法プレビュー" />
            ) : (
              <p className="placeholder">画像をアップロードしてください</p>
            )}
          </div>

          <div className="slider-group">
            <label>
              Hue: {leftParams.h_w.toFixed(0)}
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={leftParams.h_w}
                onChange={(e) =>
                  setLeftParams((prev) => ({ ...prev, h_w: Number(e.target.value) }))
                }
              />
            </label>
            <label>
              Sat: {leftParams.s_w.toFixed(2)}
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={leftParams.s_w}
                onChange={(e) =>
                  setLeftParams((prev) => ({ ...prev, s_w: Number(e.target.value) }))
                }
              />
            </label>
            <label>
              Val: {leftParams.v_w.toFixed(2)}
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={leftParams.v_w}
                onChange={(e) =>
                  setLeftParams((prev) => ({ ...prev, v_w: Number(e.target.value) }))
                }
              />
            </label>
          </div>

          <div className="apply-section">
            <div className="apply-head">
              <h3>別画像に適用</h3>
              <label className="mini-upload-btn">
                画像をアップロード
                <input type="file" accept="image/*" onChange={handleManualApplyUpload} />
              </label>
            </div>
            <div className="preview-wrap secondary">
              {manualApplyPreviewUrl ? (
                <img src={manualApplyPreviewUrl} alt="手動調整の別画像プレビュー" />
              ) : (
                <p className="placeholder">別の画像をアップロードしてください</p>
              )}
            </div>
          </div>
        </section>

        <section className="panel right-panel">
          <h2>提案手法</h2>

          {phase === 'tuning' ? (
            <>
              <div className="phase-head">
                <p>チューニングを行うよ </p>
              </div>

              <div className="candidate-grid">
                {candidates.map((candidate) => (
                  <button
                    type="button"
                    className="candidate-card"
                    key={candidate.id}
                    onClick={() => handleCandidateSelect(candidate)}
                  >
                    <img src={candidate.previewUrl} alt="ITS候補" />
                    <span>
                      h:{candidate.params.h_w.toFixed(0)} / s:{' '}
                      {candidate.params.s_w.toFixed(2)} / v:{' '}
                      {candidate.params.v_w.toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="phase2-title">フェーズ2（編集）: 感性ワードを適用</p>
              <div className="word-buttons">
                {savedWords.map((entry, idx) => (
                  <button
                    type="button"
                    key={`${entry.word}-${idx}`}
                    className={idx === appliedWordIndex ? 'active' : ''}
                    onClick={() => setAppliedWordIndex(idx)}
                  >
                    {entry.word}
                  </button>
                ))}
              </div>

              <div className="preview-wrap large">
                {rightPreviewUrl ? (
                  <img src={rightPreviewUrl} alt="提案手法プレビュー" />
                ) : (
                  <p className="placeholder">ワードを選択してください</p>
                )}
              </div>

              {appliedWordIndex >= 0 && savedWords[appliedWordIndex] ? (
                <pre className="json-box">
{JSON.stringify(savedWords[appliedWordIndex], null, 2)}
                </pre>
              ) : null}

              <button
                type="button"
                className="reset-btn tune-again"
                onClick={() => {
                  setPhase('tuning')
                  setBestParams(null)
                  if (sourceImage) {
                    const initialCandidates = createInitialCandidates(sourceImage)
                    setCandidates(initialCandidates)
                    setGeneration(1)
                  }
                }}
              >
                もう一度チューニングする
              </button>
            </>
          )}

          <div className="apply-section">
            <div className="apply-head">
              <h3>別画像に適用</h3>
              <label className="mini-upload-btn">
                画像をアップロード
                <input type="file" accept="image/*" onChange={handleProposalApplyUpload} />
              </label>
            </div>
            <div className="preview-wrap secondary">
              {proposalApplyPreviewUrl ? (
                <img src={proposalApplyPreviewUrl} alt="提案手法の別画像プレビュー" />
              ) : (
                <p className="placeholder">
                  {appliedParams ? '別の画像をアップロードしてください' : 'フェーズ2でワードを選択すると適用できます'}
                </p>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer-note">
        画像処理方式: 5x5グリッド平均色 + HSV変換 + 透明度85/255オーバーレイ
      </footer>
    </div>
  )
}

export default App
