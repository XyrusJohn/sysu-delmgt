import React, { useState } from "react";
import { SecurityGuardService } from "../../api/securityGuardService";
import { TruckCompanyService } from "../../api/truckCompanyService";
import WarehouseBaseEditor from "./WarehouseBaseEditor";

/**
 * GuardManager Component
 * List and edit security guard records.
 */
const GuardManager = () => {
  const [guards, setGuards] = useState([]);
  const [search, setSearch] = useState("");

  React.useEffect(() => {
    let active = true;
    let unsubscribe;
    SecurityGuardService.subscribe(
      (data) => {
        if (active) setGuards(Object.values(data || {}));
      },
      (error) => console.error("Security guard subscription failed:", error),
    )
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop?.();
      })
      .catch((error) =>
        console.error("Security guard subscription failed:", error),
      );
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const filtered = guards.filter(
    (g) =>
      (g.fullName || "").toLowerCase().includes(search.toLowerCase()) ||
      (g.guardId || "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search guards..."
            className="w-full h-10 bg-db-bg border border-db-border rounded-xl pl-9 pr-4 text-sm text-db-text outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="px-4 h-10 rounded-xl text-xs font-bold uppercase bg-sysu-red text-white">
          Add Guard
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((g) => (
          <div
            key={g.id}
            className="p-4 bg-db-panel border border-db-border rounded-xl flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-sysu-red/10 border border-sysu-red/20 flex items-center justify-center text-sysu-red text-xs font-bold">
                {g.fullName?.[0].toUpperCase()}
              </div>
              <div>
                <div className="text-sm font-bold text-db-text">
                  {g.fullName}
                </div>
                <div className="text-[10px] font-mono text-db-text3">
                  {g.guardId}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="px-2 py-1 text-[10px] font-bold uppercase bg-db-bg border border-db-border text-db-text3 rounded">
                Edit
              </button>
              <button
                className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${g.active ? "bg-red-500/10 text-red-400 border border-red-500/30" : "bg-green-500/10 text-green-400 border border-green-500/30"}`}
              >
                {g.active ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * TruckCompanyManager Component
 * List and edit trucking company records.
 */
const TruckCompanyManager = () => {
  const [companies, setCompanies] = useState([]);
  const [search, setSearch] = useState("");
  const [cacheInfo, setCacheInfo] = useState(null);

  React.useEffect(() => {
    let active = true;
    let unsubscribe;
    TruckCompanyService.subscribe(
      (data, metadata) => {
        if (active) setCacheInfo(metadata || null);
        if (active) setCompanies(Object.values(data || {}));
      },
      (error) => console.error("Truck company subscription failed:", error),
    )
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop?.();
      })
      .catch((error) =>
        console.error("Truck company subscription failed:", error),
      );
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const filtered = companies.filter(
    (c) =>
      (c.name || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.companyCode || "").toLowerCase().includes(search.toLowerCase()),
  );
  const readOnly = cacheInfo?.stale === true;

  return (
    <div className="flex flex-col gap-4">
      {readOnly && (
        <p className="text-xs text-amber-400" role="status">
          Saved copy · last updated{" "}
          {new Date(cacheInfo.fetchedAt).toLocaleString("en-PH", {
            timeZone: "Asia/Manila",
          })}
          . Read-only until the live list returns.
        </p>
      )}
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search companies..."
            className="w-full h-10 bg-db-bg border border-db-border rounded-xl pl-9 pr-4 text-sm text-db-text outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          disabled={readOnly}
          className="px-4 h-10 rounded-xl text-xs font-bold uppercase bg-sysu-red text-white disabled:opacity-50"
        >
          Add Company
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((c) => (
          <div
            key={c.id}
            className="p-4 bg-db-panel border border-db-border rounded-xl flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-sysu-gold/10 border border-sysu-gold/20 flex items-center justify-center text-sysu-gold text-xs font-bold">
                {c.name?.[0].toUpperCase()}
              </div>
              <div>
                <div className="text-sm font-bold text-db-text uppercase">
                  {c.name}
                </div>
                <div className="text-[10px] font-mono text-db-text3">
                  {c.companyCode}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                disabled={readOnly}
                className="px-2 py-1 text-[10px] font-bold uppercase bg-db-bg border border-db-border text-db-text3 rounded disabled:opacity-50"
              >
                Edit
              </button>
              <button
                disabled={readOnly}
                className={`px-2 py-1 text-[10px] font-bold uppercase rounded disabled:opacity-50 ${c.active ? "bg-red-500/10 text-red-400 border border-red-500/30" : "bg-green-500/10 text-green-400 border border-green-500/30"}`}
              >
                {c.active ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * DocumentsView Component
 * The main container for admin documents and warehouse settings.
 */
const DocumentsView = () => {
  const [activeTab, setActiveTab] = useState("guards");

  const tabs = [
    { id: "guards", label: "Security Guards" },
    { id: "truck-companies", label: "Truck Companies" },
    { id: "warehouse", label: "Warehouse Base" },
  ];

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-db-text font-display">
          Admin Documents
        </h1>
      </div>

      <div className="flex items-center gap-2 mb-6 border-b border-db-border pb-px">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 ${
              activeTab === tab.id
                ? "border-sysu-red text-sysu-red bg-sysu-red/5"
                : "border-transparent text-db-text3 hover:text-db-text"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === "guards" && <GuardManager />}
        {activeTab === "truck-companies" && <TruckCompanyManager />}
        {activeTab === "warehouse" && <WarehouseBaseEditor />}
      </div>
    </div>
  );
};

export default DocumentsView;
