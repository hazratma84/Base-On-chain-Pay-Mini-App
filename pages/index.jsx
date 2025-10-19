import dynamic from "next/dynamic";

// Load component without SSR (it uses window.ethereum)
const BasePayMiniApp = dynamic(
  () => import("../src/components/BasePayMiniApp"),
  { ssr: false }
);

export default function Home() {
  return <BasePayMiniApp />;
}
