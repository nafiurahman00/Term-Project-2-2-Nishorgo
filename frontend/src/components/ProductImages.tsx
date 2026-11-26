import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { PlantImage } from '@/components/product'
import { errorToast } from '@/lib/queries'
import { uploadProductImage } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const MAX_IMAGES = 8

/**
 * Admin photo manager for a plant. The first image is the cover (products.image_url);
 * the rest become the gallery (products.gallery). Files are resized in the browser
 * and uploaded straight to Supabase Storage.
 */
export function ProductImages({ images, onChange }: { images: string[]; onChange: (images: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)

  async function add(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_IMAGES - images.length)
    if (!list.length) return
    setUploading((n) => n + list.length)
    let current = images
    // Upload in parallel, but keep the order the admin picked.
    const results = await Promise.allSettled(list.map((f) => uploadProductImage(f).finally(() => setUploading((n) => n - 1))))
    for (const r of results) {
      if (r.status === 'fulfilled') current = [...current, r.value]
      else errorToast(r.reason)
    }
    onChange(current)
  }

  const move = (i: number, d: -1 | 1) => {
    const next = [...images]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) add(e.dataTransfer.files)
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium">Photos</span>
        <span className="text-xs text-muted">{images.length}/{MAX_IMAGES} · first photo is the cover</span>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {images.map((src, i) => (
          <div key={src} className="group relative">
            <PlantImage src={src} alt="" className={cn('aspect-square rounded-xl border', i === 0 ? 'border-primary' : 'border-line')} imgClassName="p-1.5" />
            {i === 0 && <span className="absolute top-1.5 left-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-fg">Cover</span>}
            <button type="button" onClick={() => onChange(images.filter((_, j) => j !== i))} aria-label="Remove photo"
              className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-surface text-muted shadow-sm hover:text-danger">
              <X className="size-3.5" />
            </button>
            <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between opacity-100 transition pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move left"
                className="grid size-6 place-items-center rounded-full bg-surface shadow-sm disabled:invisible"><ArrowLeft className="size-3.5" /></button>
              {i !== 0 && (
                <button type="button" onClick={() => onChange([src, ...images.filter((_, j) => j !== i)])}
                  className="flex h-6 items-center gap-1 rounded-full bg-surface px-2 text-[11px] font-medium shadow-sm"><Star className="size-3" /> Cover</button>
              )}
              <button type="button" disabled={i === images.length - 1} onClick={() => move(i, 1)} aria-label="Move right"
                className="grid size-6 place-items-center rounded-full bg-surface shadow-sm disabled:invisible"><ArrowRight className="size-3.5" /></button>
            </div>
          </div>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`u${i}`} className="grid aspect-square place-items-center rounded-xl border border-dashed border-line bg-surface-2 text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ))}
        {images.length + uploading < MAX_IMAGES && (
          <button type="button" onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
            className={cn('flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-center text-xs text-muted transition hover:border-primary hover:text-fg',
              dragging ? 'border-primary bg-accent/40 text-fg' : 'border-line')}>
            <ImagePlus className="size-5" />
            <span>{images.length ? 'Add photos' : 'Drop photos or click to upload'}</span>
          </button>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted">JPG, PNG or WebP. Large photos are resized to 1600px before upload.</p>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }} />
    </div>
  )
}
