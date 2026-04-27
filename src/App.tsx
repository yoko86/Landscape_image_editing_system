import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'

type FilterParams = {
  h_w: number
  s_w: number
  v_w: number
}

type Candidate = {
  id: string
  params: FilterParams
  previewUrl: string
}

type WordKey = 'clear' | 'soft' | 'deep' | 'retro'

type WordDefinition = {
  key: WordKey
  label: string
  saveWord: string
  delta: FilterParams
}

type HSV = {
  h: number
  s: number
  v: number
}

const GRID_SIZE = 5
const PATCH_ALPHA = 85 / 255
const INITIAL_HUES = [180, -90, -45, 0, 45, 90]

const WORD_DEFINITIONS: WordDefinition[] = [
  {
    key: 'clear',
    label: 'すっきりした',
    saveWord: 'すっきり',
    delta: { h_w: 0, s_w: 0.2, v_w: 0.2 },
  },
  {
    key: 'soft',
    label: 'ふわっとした',
    saveWord: 'ふわっと',
    delta: { h_w: 0, s_w: -0.2, v_w: 0.3 },
  },
  {
    key: 'deep',
    label: '深みがある',
    saveWord: '深み',
    delta: { h_w: 0, s_w: 0.1, v_w: -0.3 },
  },
  {
    key: 'retro',
    label: 'レトロな',
    saveWord: 'レトロ',
    delta: { h_w: 20, s_w: -0.1, v_w: 0 },
  },
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

function buildPreviewDataUrl(image: HTMLImageElement, params: FilterParams): string {
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
      const transformedS = clamp(hsv.s + params.s_w, 0, 1)
      const transformedV = clamp(hsv.v + params.v_w, 0, 1)
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

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function applyDelta(base: FilterParams, delta: FilterParams): FilterParams {
  return {
    h_w: clamp(toSignedHueRange(base.h_w + delta.h_w), -180, 180),
    s_w: clamp(base.s_w + delta.s_w, -1, 1),
    v_w: clamp(base.v_w + delta.v_w, -1, 1),
  }
}

function App() {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)

  const [leftParams, setLeftParams] = useState<FilterParams>(zeroParams)
  const [leftPreviewUrl, setLeftPreviewUrl] = useState<string>('')

  const [phase, setPhase] = useState<'initial-select' | 'word-tuning' | 'edit'>(
    'initial-select',
  )
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [baseParams, setBaseParams] = useState<FilterParams | null>(null)
  const [currentTuningParams, setCurrentTuningParams] = useState<FilterParams | null>(
    null,
  )
  const [tuningWordIndex, setTuningWordIndex] = useState(0)

  const [learnedByWord, setLearnedByWord] = useState<Record<WordKey, FilterParams | null>>({
    clear: null,
    soft: null,
    deep: null,
    retro: null,
  })
  const [appliedWordKey, setAppliedWordKey] = useState<WordKey>('clear')
  const [rightPreviewUrl, setRightPreviewUrl] = useState<string>('')

  const [statusText, setStatusText] = useState(
    '画像をアップロードすると比較を開始できます。',
  )

  const rightDisplayParams = useMemo(() => {
    if (phase === 'word-tuning') return currentTuningParams
    if (phase === 'edit') return learnedByWord[appliedWordKey]
    return null
  }, [appliedWordKey, currentTuningParams, learnedByWord, phase])

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
    if (!sourceImage || !rightDisplayParams) {
      setRightPreviewUrl('')
      return
    }
    setRightPreviewUrl(buildPreviewDataUrl(sourceImage, rightDisplayParams))
  }, [rightDisplayParams, sourceImage])

  useEffect(() => {
    if (!sourceImage) {
      setCandidates([])
      setPhase('initial-select')
      setBaseParams(null)
      setCurrentTuningParams(null)
      setTuningWordIndex(0)
      return
    }

    const initialCandidates: Candidate[] = INITIAL_HUES.map((hue) => {
      const params: FilterParams = {
        h_w: hue,
        s_w: 0,
        v_w: 0,
      }
      return {
        id: makeId(),
        params,
        previewUrl: buildPreviewDataUrl(sourceImage, params),
      }
    })

    setCandidates(initialCandidates)
    setPhase('initial-select')
    setBaseParams(null)
    setCurrentTuningParams(null)
    setTuningWordIndex(0)
    setLearnedByWord({ clear: null, soft: null, deep: null, retro: null })
    setAppliedWordKey('clear')
    setRightPreviewUrl('')
    setStatusText('ステップA: 6枚から好みの傾向を1枚選択してください。')
  }, [sourceImage])

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

  const resetAll = () => {
    if (originalUrl) {
      URL.revokeObjectURL(originalUrl)
    }
    setOriginalUrl(null)
    setSourceImage(null)
    setLeftParams(zeroParams)
    setLeftPreviewUrl('')
    setCandidates([])
    setBaseParams(null)
    setCurrentTuningParams(null)
    setTuningWordIndex(0)
    setLearnedByWord({ clear: null, soft: null, deep: null, retro: null })
    setAppliedWordKey('clear')
    setRightPreviewUrl('')
    setPhase('initial-select')
    setStatusText('画像をアップロードすると比較を開始できます。')
  }

  const handleCandidateSelect = (candidate: Candidate) => {
    if (phase !== 'initial-select') return

    setBaseParams(candidate.params)
    setCurrentTuningParams(candidate.params)
    setTuningWordIndex(0)
    setPhase('word-tuning')
    setStatusText(
      'ステップB: 4つのワードボタンで調整し、「この設定を保存」で次ワードへ進んでください。',
    )
  }

  const handleWordDelta = (definition: WordDefinition) => {
    if (phase !== 'word-tuning' || !currentTuningParams) return
    setCurrentTuningParams(applyDelta(currentTuningParams, definition.delta))
  }

  const handleSaveCurrentWord = () => {
    if (!baseParams || !currentTuningParams || phase !== 'word-tuning') return

    const currentDefinition = WORD_DEFINITIONS[tuningWordIndex]
    setLearnedByWord((prev) => ({
      ...prev,
      [currentDefinition.key]: currentTuningParams,
    }))

    if (tuningWordIndex >= WORD_DEFINITIONS.length - 1) {
      setPhase('edit')
      setAppliedWordKey('clear')
      setStatusText(
        '4ワードの学習が完了しました。フェーズ3でワードボタン編集を行えます。',
      )
      return
    }

    const nextIndex = tuningWordIndex + 1
    setTuningWordIndex(nextIndex)
    setCurrentTuningParams(baseParams)
    setStatusText(
      `「${WORD_DEFINITIONS[nextIndex].label}」のチューニングに進みました。`,
    )
  }

  const currentWordDefinition = WORD_DEFINITIONS[tuningWordIndex]

  const tuningProgress = `${tuningWordIndex + 1}/${WORD_DEFINITIONS.length}`

  const selectedLearnedWord = WORD_DEFINITIONS.find(
    (definition) => definition.key === appliedWordKey,
  )

  const selectedLearnedParams = learnedByWord[appliedWordKey]

  const restartTuning = () => {
    if (!sourceImage) return

    const initialCandidates: Candidate[] = INITIAL_HUES.map((hue) => {
      const params: FilterParams = {
        h_w: hue,
        s_w: 0,
        v_w: 0,
      }
      return {
        id: makeId(),
        params,
        previewUrl: buildPreviewDataUrl(sourceImage, params),
      }
    })

    setCandidates(initialCandidates)
    setPhase('initial-select')
    setBaseParams(null)
    setCurrentTuningParams(null)
    setTuningWordIndex(0)
    setLearnedByWord({ clear: null, soft: null, deep: null, retro: null })
    setAppliedWordKey('clear')
    setStatusText('ステップA: 6枚から好みの傾向を1枚選択してください。')
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
          <h2>既存手法（手動調整）</h2>
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
        </section>

        <section className="panel right-panel">
          <h2>提案手法（対話型進化計算 / ITS）</h2>

          {phase === 'initial-select' ? (
            <>
              <div className="phase-head">
                <p>ステップA（初期選択）: 6択から1枚選択</p>
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
          ) : phase === 'word-tuning' ? (
            <>
              <div className="phase-head">
                <p>
                  ステップB（ワード・チューニング） 対象: {currentWordDefinition.label}
                </p>
                <span className="progress-chip">進捗 {tuningProgress}</span>
              </div>

              <div className="preview-wrap large">
                {rightPreviewUrl ? (
                  <img src={rightPreviewUrl} alt="ワードチューニングプレビュー" />
                ) : (
                  <p className="placeholder">基準画像を選択してください</p>
                )}
              </div>

              <div className="word-buttons tuning-buttons">
                {WORD_DEFINITIONS.map((definition) => (
                  <button
                    type="button"
                    key={definition.key}
                    onClick={() => handleWordDelta(definition)}
                  >
                    {definition.label}
                  </button>
                ))}
              </div>

              <div className="tuning-controls">
                <button
                  type="button"
                  className="reset-btn"
                  onClick={() => setCurrentTuningParams(baseParams)}
                >
                  現在ワードを基準からやり直す
                </button>
                <button type="button" className="save-btn" onClick={handleSaveCurrentWord}>
                  この設定を保存
                </button>
              </div>

              {currentTuningParams ? (
                <pre className="json-box">
{JSON.stringify(
  {
    word: currentWordDefinition.saveWord,
    params: currentTuningParams,
  },
  null,
  2,
)}
                </pre>
              ) : null}
            </>
          ) : (
            <>
              <p className="phase2-title">ステップC（画像編集）: 学習済み4ワードで編集</p>
              <div className="word-buttons">
                {WORD_DEFINITIONS.map((definition) => (
                  <button
                    type="button"
                    key={definition.key}
                    className={definition.key === appliedWordKey ? 'active' : ''}
                    onClick={() => setAppliedWordKey(definition.key)}
                  >
                    {definition.saveWord}
                  </button>
                ))}
              </div>

              <div className="preview-wrap large">
                {rightPreviewUrl ? (
                  <img src={rightPreviewUrl} alt="提案手法編集プレビュー" />
                ) : (
                  <p className="placeholder">ワードを選択してください</p>
                )}
              </div>

              {selectedLearnedWord && selectedLearnedParams ? (
                <pre className="json-box">
{JSON.stringify(
  {
    word: selectedLearnedWord.saveWord,
    params: selectedLearnedParams,
  },
  null,
  2,
)}
                </pre>
              ) : null}

              <button
                type="button"
                className="reset-btn tune-again"
                onClick={restartTuning}
              >
                初期6択から再チューニングする
              </button>
            </>
          )}
        </section>
      </main>

      <footer className="footer-note">
        画像処理方式: 5x5グリッド平均色 + HSV変換 + 透明度85/255オーバーレイ
      </footer>
    </div>
  )
}

export default App
