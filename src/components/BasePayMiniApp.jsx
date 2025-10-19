import React, { useState, useEffect, useRef } from "react";
import {
  BrowserProvider,
  parseEther,
  formatEther,
  getAddress,
  isAddress,
  hexValue,
} from "ethers";

/*
  Updated for ethers v6:
  - BrowserProvider instead of ethers.providers.Web3Provider
  - named exports: parseEther, formatEther, getAddress, isAddress, hexValue
*/

export default function BasePayMiniApp() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState("0.0");
  const [network, setNetwork] = useState(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  const BASE_CHAIN_ID = 8453; // Base Mainnet
  const chainChangedHandlerRef = useRef(null);
  const accountsChangedHandlerRef = useRef(null);

  function shortAddress(addr = "") {
    try {
      const s = getAddress(addr);
      return `${s.slice(0, 6)}...${s.slice(-4)}`;
    } catch {
      return addr;
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined" && window.ethereum) {
      const web3 = new BrowserProvider(window.ethereum);
      setProvider(web3);

      const accountsChanged = async (accounts) => {
        if (!accounts || accounts.length === 0) {
          resetConnection();
          return;
        }
        const a = accounts[0];
        setAddress(a);
        await setupSigner(web3);
      };
      const chainChanged = async () => {
        try {
          const net = await web3.getNetwork();
          setNetwork(net);
          await setupSigner(web3);
          setStatus(`Switched to network ${net.name} (${net.chainId})`);
        } catch (err) {
          console.warn("chainChanged handler error", err);
        }
      };

      accountsChangedHandlerRef.current = accountsChanged;
      chainChangedHandlerRef.current = chainChanged;

      if (window.ethereum.on) {
        window.ethereum.on("accountsChanged", accountsChanged);
        window.ethereum.on("chainChanged", chainChanged);
      }
    } else {
      setStatus("No injected wallet found (MetaMask / Coinbase Wallet).");
    }

    return () => {
      try {
        if (window.ethereum && window.ethereum.removeListener) {
          if (accountsChangedHandlerRef.current)
            window.ethereum.removeListener("accountsChanged", accountsChangedHandlerRef.current);
          if (chainChangedHandlerRef.current)
            window.ethereum.removeListener("chainChanged", chainChangedHandlerRef.current);
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
      setStatus("Requesting wallet connection…");
      // BrowserProvider wraps window.ethereum; eth_requestAccounts still required
      await provider.send("eth_requestAccounts", []);
      const net = await provider.getNetwork();
      setNetwork(net);

      if (net.chainId !== BASE_CHAIN_ID) {
        setStatus(`You're on ${net.name} — attempting to switch to Base...`);
        try {
          await provider.send("wallet_switchEthereumChain", [
            { chainId: hexValue(BASE_CHAIN_ID) },
          ]);
        } catch (switchErr) {
          try {
            await provider.send("wallet_addEthereumChain", [
              {
                chainId: hexValue(BASE_CHAIN_ID),
                chainName: "Base",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://mainnet.base.org"],
                blockExplorerUrls: ["https://basescan.org"],
              },
            ]);
            await provider.send("wallet_switchEthereumChain", [
              { chainId: hexValue(BASE_CHAIN_ID) },
            ]);
          } catch (addErr) {
            console.warn("Could not add/switch to Base automatically", addErr);
            setStatus("Please switch your wallet to the Base network manually.");
          }
        }
        const newNet = await provider.getNetwork();
        setNetwork(newNet);
      }

      await setupSigner(provider);
      setStatus("Connected");
    } catch (err) {
      console.error(err);
      setStatus("Connection failed: " + (err?.message || err));
    }
  }

  async function setupSigner(p) {
    try {
      // BrowserProvider.getSigner() may be async in some runtime; support both styles
      const s = (typeof p.getSigner === "function") ? await p.getSigner() : p.getSigner();
      setSigner(s);
      const addr = await s.getAddress();
      setAddress(addr);
      const bal = await p.getBalance(addr);
      setBalance(formatEther(bal));
      const net = await p.getNetwork();
      setNetwork(net);
    } catch (err) {
      console.warn("setupSigner err", err);
      if (!address) setStatus("Please connect wallet (approve account access).");
    }
  }

  function resetConnection() {
    setProvider(null);
    setSigner(null);
    setAddress("");
    setBalance("0.0");
    setNetwork(null);
    setStatus("");
    if (typeof window !== "undefined" && window.ethereum) {
      const web3 = new BrowserProvider(window.ethereum);
      setProvider(web3);
    }
  }

  async function sendPayment(e) {
    e.preventDefault();
    if (!provider || !signer) {
      setStatus("Wallet not connected");
      return;
    }

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setStatus("Invalid amount (must be a number > 0)");
      return;
    }

    let resolvedRecipient = recipient.trim();
    try {
      if (!isAddress(resolvedRecipient)) {
        const maybeResolved = await provider.resolveName(resolvedRecipient);
        if (!maybeResolved) {
          setStatus("Recipient is not a valid address or resolvable ENS name");
          return;
        }
        resolvedRecipient = maybeResolved;
      }

      const value = parseEther(amount);
      const balBN = await provider.getBalance(address);
      if (balBN.lt(value)) {
        setStatus("Insufficient balance for the requested amount (does not include gas).");
        return;
      }

      setSending(true);
      setStatus("Preparing transaction…");

      const feeData = await provider.getFeeData();
      const tx = {
        to: resolvedRecipient,
        value,
      };

      if (feeData?.maxFeePerGas && feeData?.maxPriorityFeePerGas) {
        tx.maxFeePerGas = feeData.maxFeePerGas;
        tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
      } else if (feeData?.gasPrice) {
        tx.gasPrice = feeData.gasPrice;
      }

      const response = await signer.sendTransaction(tx);
      setStatus(`Transaction sent — hash: ${response.hash}. Waiting for confirmation...`);

      const receipt = await response.wait(1);
      if (receipt && receipt.status === 1) {
        setStatus(`Payment confirmed in block ${receipt.blockNumber}. Tx: ${response.hash}`);
        const newBal = await provider.getBalance(address);
        setBalance(formatEther(newBal));
        setRecipient("");
        setAmount("");
      } else {
        setStatus("Transaction failed or reverted");
      }
    } catch (err) {
      console.error(err);
      if (err?.code === 4001) {
        setStatus("User rejected the transaction");
      } else {
        setStatus("Send failed: " + (err?.message || String(err)));
      }
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
            <p className="text-sm text-slate-500">Quick on‑chain payments on Base L2</p>
          </div>
          <div className="text-right">
            {address ? (
              <div className="text-sm">
                <div className="font-mono text-xs text-slate-700">{shortAddress(address)}</div>
                <div className="text-xs text-slate-500">{Number(balance).toFixed(6)} ETH</div>
                <div className="text-xs text-slate-400">
                  Network: {network ? `${network.name} (${network.chainId})` : "—"}
                </div>
                <div className="mt-2">
                  <button
                    onClick={resetConnection}
                    className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs"
                  >
                    Disconnect
                  </button>
                </div>
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
                placeholder="0x... or ENS (e.g. vitalik.eth)"
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
              <div className="text-xs text-slate-500">Transaction will prompt your wallet to confirm.</div>
              <button
                type="submit"
                disabled={sending}
                className="px-4 py-2 bg-green-600 text-white rounded-md text-sm disabled:opacity-60"
              >
                {sending ? "Sending…" : "Send Payment"}
              </button>
            </div>
          </form>

          <div className="mt-4 bg-slate-50 p-3 rounded-lg text-sm text-slate-600">
            <div>Status: {status || "Idle"}</div>
          </div>

          <section className="mt-6 text-xs text-slate-500 space-y-2">
            <div>
              Tips:
              <ul className="list-disc ml-5">
                <li>Use MetaMask or Coinbase Wallet on the Base network.</li>
                <li>If your wallet is on another chain, the app will try to switch to Base (you must approve).</li>
                <li>
                  For production: add server-side protections, better gas estimation, UX for pending txs,
                  TX history, and nonce management.
                </li>
              </ul>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
        }
