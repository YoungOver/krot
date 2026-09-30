import { Hero } from './Hero'
import { Route } from './Route'
import { Faq, Footer, InspectorDemo, Nav, Pricing, Steps } from './Sections'

export function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Route />
        <Steps />
        <InspectorDemo />
        <Pricing />
        <Faq />
      </main>
      <Footer />
    </>
  )
}
