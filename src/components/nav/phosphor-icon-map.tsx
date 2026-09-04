import type { Icon as PhosphorIconType, IconWeight } from "@phosphor-icons/react";
import {
  ArrowsClockwiseIcon,
  CalendarBlankIcon,
  CalendarHeartIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckSquareIcon,
  ClipboardTextIcon,
  EnvelopeSimpleIcon,
  GearSixIcon,
  HandshakeIcon,
  HouseIcon,
  ListIcon,
  MapTrifoldIcon,
  PiggyBankIcon,
  PushPinIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SquaresFourIcon,
  UserCirclePlusIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";

// Maps the plain string keys used across nav-config.ts (kept as-is, so
// every NavItem/NavGroup definition stays untouched) onto the Phosphor
// icon components the design conventions call for. Weight is a prop,
// not a separate import — pass weight="fill" for the active/selected
// state (see design_handoff_conventions/README.md's Icons section),
// weight="regular" (the default) for everything else.
const PHOSPHOR_ICONS: Record<string, PhosphorIconType> = {
  home: HouseIcon,
  check: CheckSquareIcon,
  calendar: CalendarBlankIcon,
  calendarHeart: CalendarHeartIcon,
  clipboardText: ClipboardTextIcon,
  people: UsersThreeIcon,
  grid: SquaresFourIcon,
  budget: PiggyBankIcon,
  map: MapTrifoldIcon,
  recruitment: UserCirclePlusIcon,
  shield: ShieldCheckIcon,
  handshake: HandshakeIcon,
  gear: GearSixIcon,
  mail: EnvelopeSimpleIcon,
  cycle: ArrowsClockwiseIcon,
  chevronLeft: CaretLeftIcon,
  chevronRight: CaretRightIcon,
  chevronDown: CaretDownIcon,
  menu: ListIcon,
  close: XIcon,
  pin: PushPinIcon,
  logout: SignOutIcon,
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
  const IconComponent = PHOSPHOR_ICONS[name] ?? SquaresFourIcon;
  return <IconComponent weight={weight} size={size} className={className} />;
}
