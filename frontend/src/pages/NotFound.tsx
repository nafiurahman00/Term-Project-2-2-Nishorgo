import { Link } from 'react-router'
import { Container } from '@/components/layout'
import { Button, EmptyState } from '@/components/ui'

export default function NotFound() {
  return (
    <Container className="max-w-2xl pt-16">
      <EmptyState emoji="🥀" title="Page not found" action={<Link to="/"><Button>Back to home</Button></Link>}>
        We couldn't find what you were looking for. It may have been moved or sold out.
      </EmptyState>
    </Container>
  )
}
