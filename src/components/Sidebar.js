import React, { Component } from 'react';
import Scrollspy from 'react-scrollspy';
import Scroll from './Scroll';
import { Fade } from 'react-reveal';

import Logo from '../assets/img/logo.inline.svg';
import config from '../../config';

export class Sidebar extends Component {
  constructor(props) {
    super(props);
    this.state = {
      tabs: [
        { content: 'About', href: 'about' },
        { content: 'Experience', href: 'experience' },
        { content: 'Education', href: 'education' },
        { content: 'Skills', href: 'skills' },
        // { content: 'Interests', href: 'interests' },
        // { content: 'Awards', href: 'awards' },
      ],
    };
  }

  render() {
    const { tabs } = this.state;
    return (
      <nav
        className="navbar navbar-expand-lg navbar-dark bg-primary fixed-top"
        id="sideNav"
      >
        <a className="navbar-brand" href="#page-top">
          <Fade delay={0}>
            <span className="d-block d-lg-none">
              <Logo
                className="img-fluid mr-2"
                alt=""
                style={{ height: '32px', marginTop: '-6px' }}
              />
              {config.firstName} {config.lastName}
            </span>
          </Fade>
          <Fade delay={0}>
            <span className="d-none d-lg-block">
              <Logo
                className="img-fluid mx-auto mb-2"
                alt=""
                style={{ minWidth: '160px' }}
              />
            </span>
          </Fade>
        </a>
        {/* <button
          className="navbar-toggler"
          type="button"
          data-toggle="collapse"
          data-target="#navbarSupportedContent"
          aria-controls="navbarSupportedContent"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <span className="navbar-toggler-icon"></span>
        </button> */}
        <div className="collapse navbar-collapse" id="navbarSupportedContent">
          <Scrollspy
            items={tabs.map(s => s.href)}
            currentClassName="active"
            offset={-300}
            className="navbar-nav"
          >
            {tabs.map((tab, i) => {
              const { href, content } = tab;
              return (
                <li className="nav-item" key={href}>
                  <Scroll type="id" element={href}>
                    <Fade delay={100 + i * 100}>
                      <a className="nav-link" href={`#${href}`}>
                        {content}
                      </a>
                    </Fade>
                  </Scroll>
                </li>
              );
            })}
          </Scrollspy>
        </div>
      </nav>
    );
  }
}

export default Sidebar;
