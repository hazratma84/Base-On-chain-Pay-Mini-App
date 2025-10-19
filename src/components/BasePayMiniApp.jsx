import React, { useState, useEffect } from "react";
import { ethers } from "ethers";

// Default export a React component (Next.js friendly page or standalone React component)
// Minimal, production-ready single-file mini app for "On-Chain Pay" on Base L2
// - Connects to user's injected wallet (MetaMask, Coinbase Wallet mobile via deep link)
// - Shows ETH (BASE) balance
// - Lets user send a simple ETH transfer on Base
// - Uses Tailwind CSS for styling (no imports needed if Tailwind is configured)

export default function BasePayMiniApp() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState("0");
  const [network, setNetwork] = useState(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  // Base Mainnet chainId: 8453 (common value for Base mainnet). The app will attempt to prompt the wallet to switch if needed.
  const BASE_CHAIN_ID = 8453;

  useEffect(() => {
    // If an injected provider exists, set it up
    if (typeof window !== "undefined" && window.ethereum) {
      const p = new ethers.providers.Web3Provider(window.ethereum, "any");
      setProvider(p);

      // Listen for chain/account changes
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length === 0) {
          resetConnection();
        } else {
          setAddress(accounts[0]);
          setupSigner(p);
        }
      });

      window.ethereum.on("chainChanged", () => {
        // Reload to simplify network handling (or you could re-check and re-init provider)
        window.location.reload();
      });
    }

    return () => {
      try {
        if (window.ethereum && window.ethereum.removeListener) {
          window.ethereum.removeListener("accountsChanged", () => {});
          window.ethereum.removeListener("chainChanged", () => {});
        }
      } catch (e) {
        // ignore
      }
    };
  }, []);

  async function connectWallet() {
    if (!provider) {
      setStatus("No injected wallet found. Install MetaMask or Coinbase Wallet.");
      return;
    }
    try {
      setStatus("Connecting…");
      await provider.send("eth_requestAccounts", []);
      const pNetwork = await provider.getNetwork();
      setNetwork(pNetwork);

      // If not Base, attempt to switch or add
      if (pNetwork.chainId !== BASE_CHAIN_ID) {
        try {
          await provider.send("wallet_switchEthereumChain", [
            { chainId: ethers.utils.hexValue(BASE_CHAIN_ID) },
          ]);
        } catch (switchError) {
          // If the chain is not added, request to add Base (basic params). Wallets like MetaMask may reject — user will need to approve.
          try {
            await provider.send("wallet_addEthereumChain", [
              {
                chainId: ethers.utils.hexValue(BASE_CHAIN_ID),
                chainName: "Base",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://mainnet.base.org"],
                blockExplorerUrls: ["https://basescan.org"],
              },
            ]);
          } catch (addError) {
            console.warn("Could not add Base network automatically", addError);
            // continue — user may still be on other chain
          }
        }
      }

      setupSigner(provider);
      setStatus("Connected");
    } catch (err) {
      console.error(err);
      setStatus("Connection failed: " + (err.message || err));
    }
  }

  async function setupSigner(p) {
    try {
      const s = p.getSigner();
      setSigner(s);
      const addr = await s.getAddress();
      setAddress(addr);
      const bal = await p.getBalance(addr);
      setBalance(ethers.utils.formatEther(bal));
      const net = await p.getNetwork();
      setNetwork(net);
    } catch (err) {
      console.warn("setupSigner err", err);
    }
  }

  function resetConnection() {
    setProvider(null);
    setSigner(null);
    setAddress("");
    setBalance("0");
    setNetwork(null);
    setStatus("");
  }

  async function sendPayment(e) {
    e.preventDefault();
    if (!signer) {
      setStatus("Wallet not connected");
      return;
    }

    if (!ethers.utils.isAddress(recipient)) {
      setStatus("Invalid recipient address");
      return;
    }

    let value;
    try {
      value = ethers.utils.parseEther(amount || "0");
    } catch (err) {
      setStatus("Invalid amount");
      return;
    }

    try {
      setSending(true);
      setStatus("Preparing transaction…");

      // Build transaction
      const tx = {
        to: recipient,
        value: value,
        // gasLimit left for wallet to estimate; optionally you can set gasPrice / maxFeePerGas
      };

      // Send transaction
      const response = await signer.sendTransaction(tx);
      setStatus(`Transaction sent — hash: ${response.hash}`);

      // Wait for confirmation (1 block)
      const receipt = await response.wait(1);
      if (receipt && receipt.status === 1) {
        setStatus(`Payment confirmed in block ${receipt.blockNumber}. Tx: ${response.hash}`);
        // update balance
        const bal = await provider.getBalance(address);
        setBalance(ethers.utils.formatEther(bal));
        setRecipient("");
        setAmount("");
      } else {
        setStatus("Transaction failed or reverted");
      }
    } catch (err) {
      console.error(err);
      setStatus("Send failed: " + (err.message || err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-lg p-6">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Base On-Chain Pay</h1>
            <p className="text-sm text-slate-500">Quick on-chain payments on Base L2</p>
          </div>
          <div className="text-right">
            {address ? (
              <div className="text-sm">
                <div className="font-mono text-xs text-slate-700">{address.slice(0, 6)}...{address.slice(-4)}</div>
                <div className="text-xs text-slate-500">{balance} ETH</div>
                <div className="text-xs text-slate-400">Network: {network ? network.name + ` (${network.chainId})` : '—'}</div>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                className="px-3 py-2 bg-indigo-600 text-white rounded-md text-sm"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </header>

        <main className="mt-6">
          <form onSubmit={sendPayment} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Recipient</label>
              <input
                className="mt-1 block w-full rounded-md border-gray-200 shadow-sm p-2"
                placeholder="0x... or ENS (if supported)"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Amount (ETH)</label>
              <input
                className="mt-1 block w-full rounded-md border-gray-200 shadow-sm p-2"
                placeholder="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">Note: Transaction will prompt your wallet to confirm.</div>
              <button
                type="submit"
                disabled={sending}
                className="px-4 py-2 bg-green-600 text-white rounded-md text-sm disabled:opacity-60"
              >
                {sending ? 'Sending…' : 'Send Payment'}
              </button>
            </div>
          </form>

          <div className="mt-4 bg-slate-50 p-3 rounded-lg text-sm text-slate-600">
            <div>Status: {status || 'Idle'}</div>
          </div>

          <section className="mt-6 text-xs text-slate-500 space-y-2">
            <div>
              Tips:
              <ul className="list-disc ml-5">
                <li>Use MetaMask or Coinbase Wallet on Base network.</li>
                <li>If your wallet is on a different chain, the app will try to switch to Base (you must approve).</li>
                <li>For production, add better error handling, gas estimation, and CSRF protections on server-backed flows.</li>
              </ul>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

// End of file
