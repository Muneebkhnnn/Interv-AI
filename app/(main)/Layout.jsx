import Header from "@/components/Header";

export default function Layout({ children }) {
  return (
    <>
      <Header />
      <div className="mt-16">{children}</div>
    </>
  );
}