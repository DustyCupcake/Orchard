import type { Icon as PhosphorIconType, IconWeight } from "@phosphor-icons/react";
import {
  ArrowsClockwise,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  CheckSquare,
  Coin,
  EnvelopeSimple,
  GearSix,
  House,
  List,
  MapTrifold,
  PushPin,
  ShieldCheck,
  SignOut,
  SquaresFour,
  UserPlus,
  Users,
  X,
} from "@phosphor-icons/react";

// Maps the plain string keys used across nav-config.ts (kept as-is, so
// every NavItem/NavGroup definition stays untouched) onto the Phosphor
// icon components the design conventions call for. Weight is a prop,
// not a separate import — pass weight="fill" for the active/selected
// state (see design_handoff_conventions/README.md's Icons section),
// weight="regular" (the default) for everything else.
const PHOSPHOR_ICONS: Record<string, PhosphorIconType> = {
  home: House,
  check: CheckSquare,
  calendar: CalendarBlank,
  people: Users,
  grid: SquaresFour,
  budget: Coin,
  map: MapTrifold,
  recruitment: UserPlus,
  shield: ShieldCheck,
  gear: GearSix,
  mail: EnvelopeSimple,
  cycle: ArrowsClockwise,
  chevronLeft: CaretLeft,
  chevronRight: CaretRight,
  chevronDown: CaretDown,
  menu: List,
  close: X,
  pin: PushPin,
  logout: SignOut,
};

export function NavIcon({
  name,
  weight = "regular",
  size = 18,
  className,
}: {
  name: string;
  weight?: IconWeight;
  size?: number;
  className?: string;
}) {
  const IconComponent = PHOSPHOR_ICONS[name] ?? SquaresFour;
  return <IconComponent weight={weight} size={size} className={className} />;
}
