-- La proyección attendance_sessions no declaraba relación con employees/stores, por lo que el panel
-- (consultas con incrustación employees(...), stores(...)) fallaba: "Could not find a relationship".
-- Mismas claves compuestas que attendance_events (impiden mezclar organizaciones).
alter table public.attendance_sessions
  add constraint attendance_sessions_employee_fk foreign key (employee_id, organization_id) references public.employees (id, organization_id),
  add constraint attendance_sessions_store_fk foreign key (store_id, organization_id) references public.stores (id, organization_id);
notify pgrst, 'reload schema';
