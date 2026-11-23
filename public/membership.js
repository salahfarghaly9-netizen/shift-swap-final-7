/* Membership review and safe staff directory rendering. */
async function realRegister(){
  const name=document.getElementById('rg-nm').value.trim(),email=document.getElementById('rg-em').value.trim(),
        password=document.getElementById('rg-pw').value,department=document.getElementById('rg-dp').value.trim(),
        managerCode=document.getElementById('rg-mc').value.trim();
  if(!name||!email||!password||!department)return authErr('Fill name, email, password and department — Complete all fields');
  authErr('');
  try{
    const body={name,email,password,department};
    if(managerCode){body.role='manager';body.managerCode=managerCode;}
    const d=await api('/auth/register',{method:'POST',body:JSON.stringify(body)});
    if(d.pending){authTab('in');authErr(d.message);document.getElementById('li-em').value=email;return;}
    localStorage.setItem(TOK_KEY,d.token);REAL=true;ME=mapUser(d.user);
    await loadReal();boot();
  }catch(e){authErr(e.message);}
}

function mapUser(u){return {id:u._id,name:u.name,ar:u.name,email:u.email,role:u.role,dept:u.department,active:u.isActive!==false,membership:u.membership||(u.role==='manager'?'approved':'pending'),col:colOf(u._id),ini:iniOf(u.name),sw:{s:(u.swapStats&&u.swapStats.sent)||0,r:(u.swapStats&&u.swapStats.received)||0,c:(u.swapStats&&u.swapStats.completed)||0}};}

function rTeam(){
  const list=REAL?TEAM:USERS;
  const tc=document.getElementById('team-count');if(tc&&REAL)tc.textContent=list.filter(u=>u.active).length+' active members — Nextcare Medical Care';
  document.getElementById('tm-tb').innerHTML=list.map(u=>`
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="avc" style="width:30px;height:30px;background:${u.col}22;color:${u.col};font-size:10px">${u.ini}</div>
          <div><div style="font-weight:500">${esc(u.name)}</div><div style="font-size:11px;color:var(--tx2)">${esc(u.email||u.name)}</div></div>
        </div>
      </td>
      <td>${esc(u.dept)}</td>
      <td><span class="badge ${u.role==='manager'?'bpu':'bgy'}">${u.role}</span></td>
      <td>${u.sw.s}</td><td>${u.sw.c}</td>
      <td><span class="badge ${u.membership!=='approved'&&u.role!=='manager'?'ba':u.active===false?'br':'bg2'}">${u.membership!=='approved'&&u.role!=='manager'?'Pending approval':u.active===false?'Inactive':'Approved'}</span></td>
      <td>${REAL&&ME.role==='manager'&&u.id!==ME.id
        ?(u.membership!=='approved'&&u.role!=='manager'?'<button class="btn bp btn-xs" onclick="approveMember(\''+u.id+'\')">Review and approve</button> <button class="btn btn-xs" onclick="rejectMember(\''+u.id+'\')">Reject</button>':'')+'<button class="btn btn-xs" onclick="toggleRole(\''+u.id+'\',\''+u.role+'\')">'+(u.role==='manager'?'Make employee':'Make manager')+'</button> '
          +'<button class="btn btn-xs" onclick="resetPw(\''+u.id+'\',\''+esc(u.name.replace(/'/g,"\\'"))+'\')">Reset PW</button> '
          +'<button class="btn bd2 btn-xs" onclick="toggleActive(\''+u.id+'\','+(u.active!==false)+')">'+(u.active===false?'Activate':'Deactivate')+'</button>'
        :'—'}</td>
    </tr>`).join('');
}


document.getElementById('rg-mc').style.display='none';

if(REAL&&ME)realReload();
