/** A startup can be reserved before React commits its pane to the workspace. */
export interface PaneReservation {
  profileId: string;
  observed?: boolean;
}

export function lostReservedPane(reservation:PaneReservation,profileId:string|undefined):boolean {
  if(profileId===undefined)return reservation.observed===true;
  reservation.observed=true;
  return profileId!==reservation.profileId;
}
