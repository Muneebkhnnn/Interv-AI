import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h2 className="text-2xl font-bold">404 - Page Not Found</h2>
      <p className="mt-2 text-gray-600">Could not find the requested resource.</p>
      <Link href="/" className="mt-4 text-blue-500 underline">
        Return Home
      </Link>
    </div>
  )
}
