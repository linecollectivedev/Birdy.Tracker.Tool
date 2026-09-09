const item = (id, title, extra = {}) => ({ id, title, owner:"", status:"todo", due:"", notes:"", ...extra });
const group = (id, name, description, titles) => ({ id, name, description, items: titles.map((title, index) => item(`${id}-${index+1}`, title)) });

export const defaultData = {
  project: { name:"Birdy Web App", subtitle:"Travel Agency · Project Tracker" },
  phases: [
    { id:"discovery", name:"Discovery", description:"Product strategy, planning and development readiness", groups:[
      { ...group("vision","Product Vision Consulting","Product Strategy & Vision",["Understand Founder Vision","Build Product Vision","Build Product Principles","Define Value Proposition","Product Positioning","Define Long-term Product Vision"]), items:[
        item("vision-1","Understand Founder Vision",{owner:"Mark",due:"2026-08-28"}),
        item("vision-2","Build Product Vision",{owner:"THIEN",due:"2026-07-23"}),
        item("vision-3","Build Product Principles"),item("vision-4","Define Value Proposition"),item("vision-5","Product Positioning"),item("vision-6","Define Long-term Product Vision"),item("vision-7","New Task")
      ]},
      group("planning","Product Planning","Product Strategy & Vision",["Product Roadmap","Product Development Phasing","Product Release Planning","Feature Priority [V1] Spring 2027","New Task"]),
      group("goal-phase-1","Product Goal Output · Phase 01","Product Design & Master Prototype",["Master Prototype (Figma) Mobile & Web (Responsive)","Responsive Design System","Technical Architecture Ready","CMS Structure Ready","Business Data Prepared","API Specification Ready"]),
      group("goal-phase-2","Product Goal Output · Phase 02","Product Development",["Foundation Development","Core Feature Development","API Integration","UI Refinement During Development","Security & Authentication","Payment Integration","Responsive Web Experience","Production Beta Ready"])
    ]},
    { id:"ux", name:"UX", description:"UX strategy and experience design", groups:[
      group("ux-research","UX Research & Product Analysis","Research and product review",["Existing product review","Competitor benchmark","Experience gap analysis","User journey analysis"]),
      group("information-architecture","Product Information Architecture","Structure and navigation",["Master Sitemap","Navigation Structure","Product Architecture"]),
      group("master-flows","Master User Flow Design","Core product flows",["Onboarding","Booking","Payment","Trip Planning","Community","Profile","Reward","Settings"]),
      group("user-experience","User Experience","Journey and interaction principles",["User Journey","Decision Point","Pain Point","Interaction Principle","Conversion Flow"]),
      group("modularisation","Product Modularisation","Module planning",["Module Priority","Future Module Planning","Product Evolution Roadmap"])
    ]},
    { id:"ui", name:"UI", description:"UI design system", groups:[
      group("product-ui","Product UI","Screens, components and states",["Screen Design","Typography Component","Dropdown","Responsive","States","UI Kit","Button System","Box System","Card System","Badge","Navigation","Menu","Motion Principle","Error / 404 Design","Loading / Waiting / Process Design","Marketing Module"]),
      group("asset-system","Asset System","Reusable visual assets",["Illustration System","Icon System","Photography","Empty State","Loading State","UI Kit (Desktop / Mobile / Tablet)","Pattern","Card Template","Marketing Module"]),
      group("ui-guideline","UI Guideline Document","Design guidance",["UI Guideline Document"])
    ]},
    { id:"prototype", name:"Prototype", description:"Prototype testing (Figma responsive)", groups:[
      group("prototype-general","General Tasks","Internal responsive prototype test",["Internal Test fdasf","Product Optimisation","Improve UX","Improve UI","Improve Conversion"]),
      group("prototype-team-test","[Non-project Team] Prototype Test","External observation",["Behaviour Analysis","Pain Point","Journey"])
    ]},
    { id:"lock-proto", name:"Lock Proto", description:"Primary goal - locking prototype flow", groups:[
      group("lock-general","General Tasks","Phase handoff",["Phase 02 - Kick Off"])
    ]},
    { id:"development", name:"Development", description:"Product development", groups:[
      group("foundation-dev","Foundation Development","Technical foundations",["Project Setup","Frontend Framework","Backend Architecture","CMS Development","Database Development"]),
      group("core-dev","Core Feature Development","Core application features",["Log/In","Authentication","User Profile","Merchant Module","Booking Flow","Payment Flow","Dashboard","Search & Filter","Notification System"]),
      group("api-integration","API Integration","Internal and third-party integrations",["Internal APIs","Payment Gateway","Authentication Services","Maps & Location","Media Storage","Third-party Services"]),
      group("ui-refinement","UI Refinement During Development","Design and engineering feedback",["UI Adjustment","UX Improvement","Component Optimization","Responsive Fixes","Engineering Feedback Loop"])
    ]},
    { id:"qa", name:"Testing (QA)", description:"Testing and quality assurance", groups:[
      group("qa-general","General Tasks","Quality assurance",["Internal QA","Functional Testing","API Testing","Security Testing","Bug Fixing","Performance Optimization","Heatmap","Behaviour Analysis"])
    ]},
    { id:"launch", name:"Launch", description:"Release preparation", groups:[
      group("launch-general","General Tasks","Production release",["Beta Version","Internal UAT","External Testing","Deployment Preparation","Production Environment","Go-Live Checklist"])
    ]},
    { id:"maintenance", name:"Maintenance", description:"Post-launch maintenance", groups:[] }
  ]
};


