import React from "react";

/**
 * SidePanel Component
 * The main navigation menu for the Dashboard.
 */
const SidePanel = ({ activeView, setActiveView }) => {
  const navItems = [
    {
      id: "overview",
      label: "Overview",
      icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 0m-2-0v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    },
    {
      id: "orders",
      label: "Orders",
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 000 4h12a2 2 0 000-4H9z",
    },
    {
      id: "drivers",
      label: "Drivers",
      icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    },
    {
      id: "fleet",
      label: "Fleet",
      icon: "M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z",
    },
    {
      id: "tracking",
      label: "Tracking",
      icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z",
    },
    {
      id: "docs",
      label: "Documents",
      icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.582l4.522 4.522A1 1 0 0115 5v2a1 1 0 01-1 1H//",
    }, // Fixed SVG a bit
    {
      id: "sap",
      label: "SAP Sync",
      icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 0H4",
    },
    {
      id: "users",
      label: "User Portal",
      icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1",
    },
  ];

  return (
    <aside className="w-64 border-r border-db-border bg-db-panel/30 backdrop-blur-sm flex flex-col h-full">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-sysu-red rounded-lg flex items-center justify-center text-white font-black">
          S
        </div>
        <span className="font-display font-bold text-lg tracking-tight text-db-text">
          SYSU Admin
        </span>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeView === item.id
                ? "bg-sysu-red/10 text-sysu-red border border-sysu-red/20 shadow-sm"
                : "text-db-text3 hover:bg-db-item-hover hover:text-db-text"
            }`}
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              dangerouslySetInnerHTML={{ __html: item.icon }} // simplified for example
            />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-db-border">
        <div className="bg-db-bg rounded-xl p-3 border border-db-border">
          <div className="text-[10px] font-bold text-db-text3 uppercase tracking-widest mb-1">
            System Status
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-[11px] text-db-text2">
              All systems operational
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default SidePanel;
