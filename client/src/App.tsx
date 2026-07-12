/**
 * NEXCOM Exchange — App Router
 * Dark emerald design system — all 25 pages registered
 */
import { Suspense, lazy, useEffect } from "react";
import { usePWA } from "./hooks/usePWA";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Layout from "./components/Layout";
import { Loader2 } from "lucide-react";

// Core pages
const Dashboard         = lazy(() => import("./pages/Dashboard"));
const Home              = lazy(() => import("./pages/Home"));
const ComponentShowcase = lazy(() => import("./pages/ComponentShowcase"));
const Markets           = lazy(() => import("./pages/Markets"));
const Trade             = lazy(() => import("./pages/Trade"));
const Orders            = lazy(() => import("./pages/Orders"));
const Portfolio         = lazy(() => import("./pages/Portfolio"));

// Asset class pages
const Forex             = lazy(() => import("./pages/Forex"));
const Equities          = lazy(() => import("./pages/Equities"));
const DigitalAssets     = lazy(() => import("./pages/DigitalAssets"));
const Indices           = lazy(() => import("./pages/Indices"));

// Commodity operations
const WarehouseReceipts = lazy(() => import("./pages/WarehouseReceipts"));
const Deposits          = lazy(() => import("./pages/Deposits"));
const Payments          = lazy(() => import("./pages/Payments"));
const Warehouses        = lazy(() => import("./pages/Warehouses"));
const Delivery          = lazy(() => import("./pages/Delivery"));

// Market structure
const MarketMakers      = lazy(() => import("./pages/MarketMakers"));
const Brokers           = lazy(() => import("./pages/Brokers"));
const CorporateActions  = lazy(() => import("./pages/CorporateActions"));

// Compliance & surveillance
const Compliance        = lazy(() => import("./pages/Compliance"));
const Surveillance      = lazy(() => import("./pages/Surveillance"));

// Analytics & account
const Analytics         = lazy(() => import("./pages/Analytics"));
const Account           = lazy(() => import("./pages/Account"));
const Notifications     = lazy(() => import("./pages/Notifications"));
const PriceAlerts       = lazy(() => import("./pages/PriceAlerts"));

// Onboarding & admin
const Register          = lazy(() => import("./pages/Register"));
const Onboarding        = lazy(() => import("./pages/Onboarding"));
const Admin             = lazy(() => import("./pages/Admin"));
const BulkKycAdmin      = lazy(() => import("./pages/BulkKycAdmin"));
const AdminKycDocumentReview = lazy(() => import("./pages/AdminKycDocumentReview"));
const GingerPriceHistory = lazy(() => import("./pages/GingerPriceHistory"));
const Settlements       = lazy(() => import("./pages/Settlements"));
const Settings          = lazy(() => import("./pages/Settings"));
const Architecture      = lazy(() => import("./pages/Architecture"));
const FarmerJourney         = lazy(() => import("./pages/FarmerJourney"));
const WarehouseInventory    = lazy(() => import("./pages/WarehouseInventory"));
const CooperativeDashboard  = lazy(() => import("./pages/CooperativeDashboard"));
const MarginAccount         = lazy(() => import("./pages/MarginAccount"));
const Disputes              = lazy(() => import("./pages/Disputes"));
const SecurityAuditLog      = lazy(() => import("./pages/SecurityAuditLog"));
const SecuritySettings      = lazy(() => import("./pages/SecuritySettings"));
const WebhookConfig         = lazy(() => import("./pages/WebhookConfig"));
const IpAllowlist           = lazy(() => import("./pages/IpAllowlist"));
const TotpSetup             = lazy(() => import("./pages/TotpSetup"));
const DeviceSessions        = lazy(() => import("./pages/DeviceSessions"));
const VelocityLimits        = lazy(() => import("./pages/VelocityLimits"));
const CashWithdrawal        = lazy(() => import("./pages/CashWithdrawal"));
const AMLDashboard          = lazy(() => import("./pages/AMLDashboard"));
const SARFiling             = lazy(() => import("./pages/SARFiling"));
const SettlementEngine      = lazy(() => import("./pages/SettlementEngine"));
const SettlementFails       = lazy(() => import("./pages/SettlementFails"));
const RegulatoryReports     = lazy(() => import("./pages/RegulatoryReports"));
const ReportSchedules       = lazy(() => import("./pages/ReportSchedules"));
const MarketMakerDashboard  = lazy(() => import("./pages/MarketMakerDashboard"));
const MarketMakerPerformance = lazy(() => import("./pages/MarketMakerPerformance"));
const MarginCallDashboard   = lazy(() => import("./pages/MarginCallDashboard"));
const MarginHealth          = lazy(() => import("./pages/MarginHealth"));
const InvestorRelations     = lazy(() => import("./pages/InvestorRelations"));
const IRAdmin               = lazy(() => import("./pages/IRAdmin"));
const TradeSurveillance     = lazy(() => import("./pages/TradeSurveillance"));
const DerivativesDashboard  = lazy(() => import("./pages/DerivativesDashboard"));
const FuturesTrading        = lazy(() => import("./pages/FuturesTrading"));
const OptionsAdmin              = lazy(() => import("./pages/OptionsAdmin"));
const DerivativesRiskDashboard  = lazy(() => import("./pages/DerivativesRiskDashboard"));
const PortfolioAnalytics        = lazy(() => import("./pages/PortfolioAnalytics"));
const FarmerOnboarding          = lazy(() => import("./pages/FarmerOnboarding"));
const FarmerDashboard           = lazy(() => import("./pages/FarmerDashboard"));
const FarmerKYC                 = lazy(() => import("./pages/FarmerKYC"));
const FarmerFarms               = lazy(() => import("./pages/FarmerFarms"));
const FarmerCropListings        = lazy(() => import("./pages/FarmerCropListings"));
const FarmerAdmin               = lazy(() => import("./pages/FarmerAdmin"));
const FarmerMarketPrices        = lazy(() => import("./pages/FarmerMarketPrices"));
const FarmerEarnings            = lazy(() => import("./pages/FarmerEarnings"));
const TraderOnboarding          = lazy(() => import("./pages/TraderOnboarding"));
const TraderDashboard           = lazy(() => import("./pages/TraderDashboard"));
const TraderTradeHistory        = lazy(() => import("./pages/TraderTradeHistory"));
const TraderOpenOrders          = lazy(() => import("./pages/TraderOpenOrders"));
const TraderPnL                 = lazy(() => import("./pages/TraderPnL"));
const BrokerOnboarding          = lazy(() => import("./pages/BrokerOnboarding"));
const BrokerDashboard           = lazy(() => import("./pages/BrokerDashboard"));
const BrokerCommissions         = lazy(() => import("./pages/BrokerCommissions"));
const BrokerClientOnboarding    = lazy(() => import("./pages/BrokerClientOnboarding"));
const PushNotificationSettings  = lazy(() => import("./pages/PushNotificationSettings"));
const WarehouseOpOnboarding     = lazy(() => import("./pages/WarehouseOpOnboarding"));
const WarehouseDashboard        = lazy(() => import("./pages/WarehouseDashboard"));
const MarketMakerOnboarding     = lazy(() => import("./pages/MarketMakerOnboarding"));
const MarketMakerOnboardingDashboard = lazy(() => import("./pages/MarketMakerOnboardingDashboard"));
const MarketMakerQuotes              = lazy(() => import("./pages/MarketMakerQuotes"));
const OnboardingHub          = lazy(() => import("./pages/OnboardingHub"));
const AdminStakeholders      = lazy(() => import("./pages/AdminStakeholders"));
const AdminReKycFlags        = lazy(() => import("./pages/AdminReKycFlags"));
const AdminUserDetail        = lazy(() => import("./pages/AdminUserDetail"));
const AdminUserList          = lazy(() => import("./pages/AdminUserList"));
const AdminPlatformHealth    = lazy(() => import("./pages/AdminPlatformHealth"));
const AdminFIXGateway        = lazy(() => import("./pages/AdminFIXGateway"));
const PerformanceMetrics     = lazy(() => import("./pages/PerformanceMetrics"));
const PriceFeedAdmin         = lazy(() => import("./pages/PriceFeedAdmin"));
const AdminWarehouseMessages = lazy(() => import("./pages/AdminWarehouseMessages"));
const NotFound                  = lazy(() => import("./pages/NotFound"));
const BlockchainTokenization    = lazy(() => import("./pages/BlockchainTokenization"));
const AiMlDashboard             = lazy(() => import("./pages/AiMlDashboard"));
const RiskManagement            = lazy(() => import("./pages/RiskManagement"));
const LakehouseDashboard        = lazy(() => import("./pages/LakehouseDashboard"));
const Mojaloop                  = lazy(() => import("./pages/Mojaloop"));
const MojaloopOnboard           = lazy(() => import("./pages/MojaloopOnboard"));
const MojaloopReconciliation    = lazy(() => import("./pages/MojaloopReconciliation"));
const MojaloopTiers             = lazy(() => import("./pages/MojaloopTiers"));
const TokenExplorer             = lazy(() => import("./pages/TokenExplorer"));
const DfspKycReview             = lazy(() => import("./pages/DfspKycReview"));
const ComplianceDashboard       = lazy(() => import("./pages/ComplianceDashboard"));
const Watchlist                  = lazy(() => import("./pages/Watchlist"));
const ApiDocs                    = lazy(() => import("./pages/ApiDocs"));
const FixedIncome                = lazy(() => import("./pages/FixedIncome"));
const WorkBench                  = lazy(() => import("./pages/WorkBench"));
const ABCPMarkets                = lazy(() => import("./pages/ABCPMarkets"));
const InputFinancing             = lazy(() => import("./pages/InputFinancing"));
const BankingDashboard           = lazy(() => import("./pages/BankingDashboard"));
const FieldAgents                = lazy(() => import("./pages/FieldAgents"));
const CropReports                = lazy(() => import("./pages/CropReports"));
const ChannelDashboard           = lazy(() => import("./pages/ChannelDashboard"));
const Ledger                     = lazy(() => import("./pages/Ledger"));
const PolicyManagement           = lazy(() => import("./pages/PolicyManagement"));
const CreditScore                = lazy(() => import("./pages/CreditScore"));
const MicroservicesHealth        = lazy(() => import("./pages/MicroservicesHealth"));
const MiddlewareHealth           = lazy(() => import("./pages/MiddlewareHealth"));
const DistributedTracing         = lazy(() => import("./pages/DistributedTracing"));
const ExchangeOperatorOnboarding = lazy(() => import("./pages/ExchangeOperatorOnboarding"));
const SpotFx                     = lazy(() => import("./pages/SpotFx"));
const UserProfileDashboard       = lazy(() => import("./pages/UserProfileDashboard"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Core */}
        <Route path="/"                  component={Dashboard} />
        <Route path="/home"               component={Home} />
        <Route path="/showcase"           component={ComponentShowcase} />
        <Route path="/markets"           component={Markets} />
        <Route path="/trade"             component={Trade} />
        <Route path="/trade/:symbol"     component={Trade} />
        <Route path="/orders"            component={Orders} />
        <Route path="/portfolio"         component={Portfolio} />

        {/* Asset classes */}
        <Route path="/forex"             component={Forex} />
        <Route path="/equities"          component={Equities} />
        <Route path="/digital-assets"    component={DigitalAssets} />
        <Route path="/indices"           component={Indices} />

        {/* Commodity operations */}
        <Route path="/receipts"          component={WarehouseReceipts} />
        <Route path="/deposits"          component={Deposits} />
        <Route path="/payments"          component={Payments} />
        <Route path="/warehouses"        component={Warehouses} />
        <Route path="/delivery"          component={Delivery} />

        {/* Market structure */}
        <Route path="/market-makers"     component={MarketMakers} />
        <Route path="/brokers"           component={Brokers} />
        <Route path="/corporate-actions" component={CorporateActions} />

        {/* Compliance & surveillance */}
        <Route path="/compliance"        component={Compliance} />
        <Route path="/surveillance"      component={Surveillance} />

        {/* Analytics & account */}
        <Route path="/analytics"         component={Analytics} />
        <Route path="/profile"           component={UserProfileDashboard} />
        <Route path="/account"           component={Account} />
        <Route path="/notifications"     component={Notifications} />
        <Route path="/alerts"            component={PriceAlerts} />

        {/* Onboarding & admin */}
        <Route path="/register"          component={Register} />
        <Route path="/onboarding"        component={Onboarding} />
         <Route path="/admin"             component={Admin} />
         <Route path="/admin/bulk-kyc"    component={BulkKycAdmin} />
         <Route path="/admin/kyc-review"   component={AdminKycDocumentReview} />
        <Route path="/settlements"        component={Settlements} />
        <Route path="/settings"           component={Settings} />
        <Route path="/architecture"        component={Architecture} />
         <Route path="/farmer-journey"      component={FarmerJourney} />
         <Route path="/ginger-price-history"  component={GingerPriceHistory} />
         <Route path="/warehouse-inventory"    component={WarehouseInventory} />
         <Route path="/cooperative"            component={CooperativeDashboard} />
         <Route path="/cooperative-admin"       component={CooperativeDashboard} />
         <Route path="/margin"                  component={MarginAccount} />
         <Route path="/disputes"                component={Disputes} />
         <Route path="/security"                 component={SecurityAuditLog} />
         <Route path="/security-settings"         component={SecuritySettings} />
         <Route path="/webhook-config"             component={WebhookConfig} />
         <Route path="/ip-allowlist"               component={IpAllowlist} />
         <Route path="/totp-setup"                component={TotpSetup} />
         <Route path="/device-sessions"           component={DeviceSessions} />
         <Route path="/velocity-limits"           component={VelocityLimits} />
         <Route path="/cash-withdrawal"            component={CashWithdrawal} />
         <Route path="/aml"                        component={AMLDashboard} />
         <Route path="/sar-filing"                 component={SARFiling} />
         <Route path="/settlement-engine"          component={SettlementEngine} />
         <Route path="/settlement-fails"           component={SettlementFails} />
         <Route path="/regulatory-reports"         component={RegulatoryReports} />
         <Route path="/report-schedules"           component={ReportSchedules} />
         <Route path="/market-maker-dashboard"     component={MarketMakerDashboard} />
         <Route path="/market-maker-performance"   component={MarketMakerPerformance} />
         <Route path="/investor-relations"           component={InvestorRelations} />
         <Route path="/ir-admin"                     component={IRAdmin} />
         <Route path="/clearing-house"               component={MarginCallDashboard} />
         <Route path="/margin-health"                component={MarginHealth} />
         <Route path="/trade-surveillance"           component={TradeSurveillance} />
         <Route path="/derivatives"                   component={DerivativesDashboard} />
         <Route path="/futures-trading"               component={FuturesTrading} />
         <Route path="/options-admin"                  component={OptionsAdmin} />
         <Route path="/derivatives-risk"                component={DerivativesRiskDashboard} />
         <Route path="/portfolio-analytics"              component={PortfolioAnalytics} />
         {/* Farmer Onboarding PWA */}
         <Route path="/farmer-onboarding"                component={FarmerOnboarding} />
         <Route path="/farmer-dashboard"                 component={FarmerDashboard} />
         <Route path="/farmer-kyc"                       component={FarmerKYC} />
         <Route path="/farmer-farms"                     component={FarmerFarms} />
         <Route path="/farmer-crops"                     component={FarmerCropListings} />
         <Route path="/farmer-admin"                     component={FarmerAdmin} />
         <Route path="/farmer-market"                    component={FarmerMarketPrices} />
         <Route path="/farmer-earnings"                  component={FarmerEarnings} />
         <Route path="/trader-onboarding"                component={TraderOnboarding} />
         <Route path="/trader-dashboard"                 component={TraderDashboard} />
         <Route path="/trader/trade-history"             component={TraderTradeHistory} />
         <Route path="/trader/open-orders"               component={TraderOpenOrders} />
         <Route path="/trader/pnl"                       component={TraderPnL} />
         <Route path="/broker-onboarding"                component={BrokerOnboarding} />
         <Route path="/broker-dashboard"                 component={BrokerDashboard} />
         <Route path="/broker/commissions"               component={BrokerCommissions} />
         <Route path="/broker/onboard-client"          component={BrokerClientOnboarding} />
         <Route path="/settings/push-notifications"    component={() => <PushNotificationSettings />} />
         <Route path="/warehouse-onboarding"             component={WarehouseOpOnboarding} />
         <Route path="/warehouse-dashboard"              component={WarehouseDashboard} />
         <Route path="/market-maker-onboarding"          component={MarketMakerOnboarding} />
         <Route path="/market-maker-onboarding-dashboard" component={MarketMakerOnboardingDashboard} />
         <Route path="/market-maker-quotes"               component={MarketMakerQuotes} />
         {/* Unified Onboarding Hub & Admin Stakeholder Dashboard */}
         <Route path="/join"                                 component={OnboardingHub} />
         <Route path="/admin/stakeholders"                   component={AdminStakeholders} />
         <Route path="/admin/re-kyc-flags"                   component={AdminReKycFlags} />
         <Route path="/admin/users"                          component={AdminUserList} />
         <Route path="/admin/users/:id"                       component={AdminUserDetail} />
         <Route path="/admin/platform-health"                   component={AdminPlatformHealth} />
         <Route path="/admin/fix-gateway"                    component={AdminFIXGateway} />
         <Route path="/admin/performance-metrics"              component={PerformanceMetrics} />
         <Route path="/admin/price-feed"                       component={PriceFeedAdmin} />
         <Route path="/admin/warehouse-messages"               component={AdminWarehouseMessages} />
        <Route path="/blockchain"                              component={BlockchainTokenization} />
        <Route path="/ai-ml"                                  component={AiMlDashboard} />
        <Route path="/risk-management"                        component={RiskManagement} />
        <Route path="/lakehouse"                               component={LakehouseDashboard} />
        <Route path="/mojaloop"                                component={Mojaloop} />
        <Route path="/mojaloop/onboard"                        component={MojaloopOnboard} />
        <Route path="/mojaloop/reconciliation"                 component={MojaloopReconciliation} />
        <Route path="/mojaloop/tiers"                          component={MojaloopTiers} />
        <Route path="/blockchain/explorer"                     component={TokenExplorer} />
        <Route path="/admin/dfsp-kyc"                          component={DfspKycReview} />
        <Route path="/compliance-dashboard"                    component={ComplianceDashboard} />
        <Route path="/watchlist"                                component={Watchlist} />
        <Route path="/docs/api"                                 component={ApiDocs} />
        <Route path="/fixed-income"                               component={FixedIncome} />
        <Route path="/workbench"                                  component={WorkBench} />
        <Route path="/abcp-markets"                               component={ABCPMarkets} />
        <Route path="/input-financing"                            component={InputFinancing} />
        <Route path="/banking"                                     component={BankingDashboard} />
        <Route path="/field-agents"                               component={FieldAgents} />
        <Route path="/crop-reports"                               component={CropReports} />
        <Route path="/channel-dashboard"                           component={ChannelDashboard} />
        <Route path="/ledger"                                       component={Ledger} />
        <Route path="/policy-management"                             component={PolicyManagement} />
        <Route path="/credit-score"                                   component={CreditScore} />
        <Route path="/admin/microservices"                            component={MicroservicesHealth} />
        <Route path="/admin/middleware-health"                         component={MiddlewareHealth} />
        <Route path="/admin/distributed-tracing"                       component={DistributedTracing} />
        <Route path="/admin/exchange-operators"                        component={ExchangeOperatorOnboarding} />
        <Route path="/spot-fx"                                         component={SpotFx} />
        {/* 404 */}
        <Route                           component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function PWAManager() {
  const { isInstallable, isOffline, promptInstall } = usePWA();

  useEffect(() => {
    if (isOffline) {
      toast.warning("You are offline", { description: "Some features may be unavailable.", duration: Infinity, id: "offline" });
    } else {
      toast.dismiss("offline");
    }
  }, [isOffline]);

  useEffect(() => {
    if (isInstallable) {
      toast.info("Install NEXCOM Exchange", {
        description: "Add to your home screen for the best experience.",
        action: { label: "Install", onClick: () => promptInstall() },
        duration: 8000,
        id: "install-prompt",
      });
    }
  }, [isInstallable, promptInstall]);

  return null;
}

export default function App() {
  return (
    <ErrorBoundary pageName="NEXCOM Exchange">
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster richColors position="top-right" />
          <PWAManager />
          <Layout>
            {/* Per-page boundary: isolates route-level crashes from the nav shell */}
            <ErrorBoundary pageName="Page">
              <Router />
            </ErrorBoundary>
          </Layout>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
