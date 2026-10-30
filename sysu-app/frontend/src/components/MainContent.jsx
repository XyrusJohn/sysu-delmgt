import React from "react";
import MapView from "./views/MapView";
import FleetManagerView from "./views/FleetManagerView";
import OrdersView from "./views/OrdersView";
import SAPView from "./views/SAPView";
import AdminPortalView from "./views/AdminPortalView";
import TrackingView from "./views/TrackingView";
import DocumentsView from "./views/DocumentsView";

/**
 * MainContent Component
 * A dynamic view switcher that renders the selected page based on activeView.
 */
const MainContent = ({ activeView }) => {
  switch (activeView) {
    case "overview":
    case "home":
      return <MapView />;
    case "fleet":
      return <FleetManagerView />;
    case "orders":
      return <OrdersView />;
    case "sap":
      return <SAPView />;
    case "users":
      return <AdminPortalView />;
    case "tracking":
      return <TrackingView />;
    case "docs":
      return <DocumentsView />;
    default:
      return <MapView />;
  }
};

export default MainContent;
