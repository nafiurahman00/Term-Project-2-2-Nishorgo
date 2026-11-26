import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Container } from '@/components/layout'
import { PlantImage } from '@/components/product'
import { Badge, Button, ProgressRing, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { errorToast } from '@/lib/queries'
import type { Difficulty, Light, ProductCard } from '@/lib/types'
import { cn, money } from '@/lib/utils'

interface Answers {
  light?: Light
  experience?: Difficulty
  has_pets?: boolean
  water_tolerance?: number
  wants: string[]
}

const STEPS = [
  {
    key: 'light', title: 'How much light does your spot get?',
    options: [
      { value: 'low', emoji: '🌥️', label: 'Not much', hint: 'North-facing or far from windows' },
      { value: 'medium', emoji: '⛅', label: 'Some', hint: 'A few hours of soft light' },
      { value: 'bright_indirect', emoji: '🌤️', label: 'Bright, indirect', hint: 'Near a sunny window, no harsh rays' },
      { value: 'full_sun', emoji: '☀️', label: 'Full sun', hint: 'Balcony or rooftop, 5+ hours of sun' },
    ],
  },
  {
    key: 'experience', title: 'How green is your thumb?',
    options: [
      { value: 'easy', emoji: '🌱', label: 'Just starting', hint: 'Please be forgiving' },
      { value: 'moderate', emoji: '🌿', label: 'Some experience', hint: "I've kept a few plants alive" },
      { value: 'expert', emoji: '🌳', label: 'Seasoned grower', hint: 'Bring on the divas' },
    ],
  },
  {
    key: 'water_tolerance', title: 'How often will you realistically water?',
    options: [
      { value: 1, emoji: '💧', label: 'Daily', hint: 'I love a routine' },
      { value: 3, emoji: '🗓️', label: 'Every few days', hint: 'Twice a week or so' },
      { value: 7, emoji: '🏖️', label: 'Once a week', hint: 'I travel or forget' },
    ],
  },
  {
    key: 'has_pets', title: 'Any curious pets at home?',
    options: [
      { value: true, emoji: '🐈', label: 'Yes', hint: 'Only show pet-safe plants' },
      { value: false, emoji: '🙅', label: 'No pets', hint: 'Show me everything' },
    ],
  },
  {
    key: 'wants', title: 'Anything you especially want?', multi: true,
    options: [
      { value: 'flowers', emoji: '🌸', label: 'Flowers', hint: 'Colour and blooms' },
      { value: 'edible', emoji: '🍅', label: 'Something edible', hint: 'Grow your own food' },
      { value: 'air_purifying', emoji: '🌬️', label: 'Cleaner air', hint: 'Natural air purifiers' },
      { value: 'compact', emoji: '🪴', label: 'Compact', hint: 'Under 60 cm' },
    ],
  },
] as const

export default function Match() {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>({ wants: [] })
  const match = useMutation({
    mutationFn: (a: Answers) => api.post<ProductCard[]>('/plant-match', a),
    onError: errorToast,
  })
  const done = step >= STEPS.length
  const current = STEPS[Math.min(step, STEPS.length - 1)]

  const choose = (value: unknown) => {
    if ('multi' in current && current.multi) {
      setAnswers((a) => ({ ...a, wants: a.wants.includes(value as string) ? a.wants.filter((w) => w !== value) : [...a.wants, value as string] }))
      return
    }
    const next = { ...answers, [current.key]: value }
    setAnswers(next)
    setStep((s) => s + 1)
  }
  const finish = () => {
    setStep(STEPS.length)
    match.mutate(answers)
  }
  const restart = () => {
    setAnswers({ wants: [] })
    setStep(0)
    match.reset()
  }

  return (
    <Container className="max-w-5xl pt-6">
      <div className="mb-10 text-center">
                <h1 className="text-3xl font-semibold md:text-4xl">{done ? 'Plants that suit you' : 'Find the right plant'}</h1>
      </div>

      {!done && (
        <div className="mx-auto mb-10 flex max-w-md gap-2">
          {STEPS.map((_, i) => (
            <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <motion.div className="h-full bg-primary" initial={false} animate={{ width: i < step ? '100%' : i === step ? '50%' : '0%' }} />
            </div>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        {!done ? (
          <motion.div key={step} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.3 }}>
            <h2 className="mb-6 text-center text-xl font-semibold">{current.title}</h2>
            <div className={cn('mx-auto grid max-w-4xl gap-4', current.options.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : current.options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2 max-w-xl')}>
              {current.options.map((o) => {
                const selected = 'multi' in current ? answers.wants.includes(o.value as string) : answers[current.key as keyof Answers] === o.value
                return (
                  <motion.button key={String(o.value)} onClick={() => choose(o.value)}
                    className={cn('rounded-xl border bg-surface p-5 text-left transition', selected ? 'border-primary ring-1 ring-primary' : 'border-line hover:border-fg/30')}>
                                        <div className="font-medium">{o.label}</div>
                    <div className="text-sm text-muted">{o.hint}</div>
                  </motion.button>
                )
              })}
            </div>
            <div className="mt-10 flex justify-center gap-3">
              {step > 0 && <Button variant="ghost" onClick={() => setStep((s) => s - 1)}><ArrowLeft className="size-4" /> Back</Button>}
              {'multi' in current && <Button size="lg" onClick={finish}>Show my matches <ArrowRight className="size-4" /></Button>}
            </div>
          </motion.div>
        ) : (
          <motion.div key="results" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            {match.isPending ? (
              <div className="py-20 text-center">
                <Spinner className="mx-auto size-6" />
                <p className="mt-4 text-muted">Finding your matches…</p>
              </div>
            ) : (
              <>
                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {match.data?.map((p, i) => (
                    <motion.div key={p.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                      <Link to={`/plants/${p.slug}`} className="group block rounded-2xl border border-line bg-surface p-4 transition hover:-translate-y-1 hover:shadow-xl">
                        <div className="relative">
                          <PlantImage src={p.image_url} alt={p.name} className="aspect-[4/3] rounded-xl" />
                          <div className="absolute top-3 right-3 rounded-full bg-surface p-1 shadow-lg">
                            <ProgressRing value={p.match ?? 0} size={58}>{p.match}%</ProgressRing>
                          </div>
                          {i === 0 && <Badge className="absolute top-3 left-3 bg-surface text-fg shadow-sm">Best match</Badge>}
                        </div>
                        <div className="mt-4 flex items-baseline justify-between px-1">
                          <h3 className="text-lg font-semibold">{p.name}</h3>
                          <span className="font-bold">{money(p.price)}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5 px-1">
                          {p.reasons?.map((r) => <Badge key={r} className="bg-surface-2 text-muted">{r}</Badge>)}
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </div>
                {match.data?.length === 0 && <p className="text-center text-muted">No plants matched every answer — try relaxing the pet or watering filters.</p>}
                <div className="mt-12 text-center"><Button variant="outline" onClick={restart}><RefreshCw className="size-4" /> Retake quiz</Button></div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Container>
  )
}
