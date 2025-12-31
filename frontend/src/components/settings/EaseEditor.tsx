import { useEffect, useRef, useState, useCallback } from "react"
import { gsap } from "gsap"
import { CustomEase } from "gsap/CustomEase"
import { PathEditor } from "gsap/utils/PathEditor"

gsap.registerPlugin(CustomEase, PathEditor)

interface EaseEditorProps {
  value: string
  onSave: (svg: string) => void
}

const EaseEditor = ({ value, onSave }: EaseEditorProps) => {
  const [easeString, setEaseString] = useState(value)
  const [isInvalid, setIsInvalid] = useState(false)

  const mainPathRef = useRef<SVGPathElement>(null)
  const jointRef = useRef<SVGCircleElement>(null)
  const editorRef = useRef<any>(null)
  const tweenRef = useRef<gsap.core.Tween | null>(null)

  const duration = 2.5

  const updateEase = useCallback(() => {
    if (!editorRef.current || !jointRef.current) return

    let errored = false
    let normalized = value

    try {
      normalized = editorRef.current.getNormalizedSVG(500, 500, true, () => {
        errored = true
      })
    } catch {
      errored = true
    }

    setIsInvalid(errored)
    setEaseString(normalized)

    if (errored) return

    tweenRef.current?.kill()

    const newEase = CustomEase.create(`live_${Date.now()}`, normalized)

    tweenRef.current = gsap.to(jointRef.current, {
      duration,
      repeat: -1,
      attr: { cy: 0 },
      ease: newEase,
    })
  }, [value, duration])

  useEffect(() => {
    if (!mainPathRef.current || !jointRef.current) return

    gsap.set(jointRef.current, { attr: { cx: 500, cy: 500 } })

    editorRef.current = PathEditor.create(mainPathRef.current, {
      selected: true,
      onRelease: updateEase,
    })

    updateEase()

    return () => {
      tweenRef.current?.kill()
      editorRef.current?.kill()
    }
  }, [updateEase])

  return (
    <div className="bg-black p-4 rounded-lg space-y-4">
      <svg viewBox="0 0 500 500" className="w-full h-64">
        <path ref={mainPathRef} d={value} stroke="transparent" fill="none" strokeWidth="20" />
        <circle ref={jointRef} cx="500" cy="500" r="10" fill="#0ae448" />
      </svg>

      <div className="text-white text-xs break-all">{easeString}</div>

      <button
        className="px-3 py-2 bg-emerald-600 rounded"
        disabled={isInvalid}
        onClick={() => onSave(easeString)}
      >
        Save Ease
      </button>
    </div>
  )
}

export default EaseEditor
