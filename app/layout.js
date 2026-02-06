import './globals.css'

export const metadata = {
  title: '0xiinko v1.0.0 - Trading Bot',
  description: 'Tile-based crypto trading bot with MA crossover strategy',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-gray-100 min-h-screen">
        {children}
      </body>
    </html>
  )
}
